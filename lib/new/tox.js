var buffertools = require('buffertools');
var fs = require('fs');
var ref = require('ref');
var ffi = require('ffi');
var path = require('path');
var _ = require('underscore');
var RefArray = require('ref-array');
var RefStruct = require('ref-struct');

var consts = require(path.join(__dirname, 'consts'));
var util = require(path.join(__dirname, 'util'));
var size_t = util.size_t;

buffertools.extend();

// Tox types
var _Tox = ref.types.void;
var _ToxPtr = ref.refType(_Tox);
var ToxOptions = RefStruct({
  'ipv6enabled': 'uint8',
  'udp_disabled': 'uint8',
  'proxy_type': 'uint8',
  'proxy_address': RefArray('char', 256), // char[256], null-termd
  'proxy_port': 'uint16',
  'start_port': 'uint16',
  'end_port': 'uint16'
});
var _ToxOptionsPtr = ref.refType(ToxOptions);

// Common types
var _UInt8Ptr = ref.refType('uint8');
var _UInt16Ptr = ref.refType('uint16');
var _UInt32Ptr = ref.refType('uint32');
var _Int8Ptr = ref.refType('int8');
var _Int16Ptr = ref.refType('int16');
var _Int32Ptr = ref.refType('int32');
var _SizePtr = ref.refType('size_t');

// Tox error types
// IMPORTANT: These might not actually be uint8s, but it's not possible
// to be sure as it could vary depending on the compiler (probably?).
// Since the range of values should be far less than 256, treating as an
// uint8 should be fine for little-endian architectures.
var _ToxErrorType = 'uint8';
var _ToxErrorNewPtr = ref.refType(_ToxErrorType);
var _ToxErrorBootstrapPtr = ref.refType(_ToxErrorType);
var _ToxOptionsErrorNewPtr = ref.refType(_ToxErrorType);

/**
 * Creates a Tox instance.
 * @class
 * @param {Object} [opts] Options
 */
var Tox = function(opts) {
  if(!opts) opts = {};
  var libpath = opts['path'];

  var toxOptions = this._createToxOptions(opts);

  this._library = this.createLibrary(libpath);
  this._initNew(toxOptions);
};

/**
 * Create a _ToxOptions from opts passed to Tox.
 * @priv
 * @param {Object} opts
 * @return {ToxOptions} Options
 */
Tox.prototype._createToxOptions = function(opts) {
  var toxopts = new ToxOptions(),
      ipv6 = opts['ipv6'],
      udp = opts['udp'];

  // Set proxy settings to defaults
  toxopts.proxy_address.buffer.fill(0);
  toxopts.proxy_type = consts.TOX_PROXY_TYPE_NONE;
  toxopts.proxy_port = 0;

  ipv6 = (ipv6 !== undefined ? !!ipv6 : false);
  udp = (udp !== undefined ? !!udp : true);

  toxopts.ipv6enabled = (ipv6 ? 1 : 0);
  toxopts.udp_disabled = (udp ? 0 : 1);

  this._setProxyToToxOptions(opts, toxopts);

  return toxopts;
};

/**
 * Set the proxy part of ToxOptions from opts.
 * @priv
 * @param {Object} opts
 * @param {ToxOptions} options
 */
Tox.prototype._setProxyToToxOptions = function(opts, options) {
  var proxy = opts['proxy'];

  if(_.isString(proxy)) {
    proxy = util.parseProxy(proxy);
    // Todo: Debug/error log if couldn't parse proxy string?
  }

  if(_.isObject(proxy)) {
    // Set proxy type
    options.proxy_type = TOX_PROXY_NONE;
    if(_.isString(proxy.type)) {
      if(/^http$/i.test(proxy.type)) options.proxy_type = TOX_PROXY_TYPE_HTTP;
      else if(/^socks5?$/i.test(proxy.type)) options.proxy_type = TOX_PROXY_TYPE_SOCKS5;
    }

    if(options.proxy_type !== TOX_PROXY_TYPE_NONE) {
      // Set address, max string length 255
      if(_.isString(proxy.address)) {
        options.proxy_address.buffer.write(proxy.address, 0, options.proxy_address.length - 1);
      }

      // Set port
      if(_.isNumber(proxy.port)) {
        options.proxy_port = proxy.port;
      }
    }
  }
};

/**
 * Initialize with tox_new.
 * @priv
 * @param {ToxOptions} [options]
 * @todo options, error handling, loading state
 */
Tox.prototype._initNew = function(options) {
  var size = size_t(0),
      errorPtr = ref.alloc(_ToxErrorType);

  if(options) {
    options = options.ref();
  } else { // If no options passed, use null pointer
    options = ref.NULL;
  }

  this._handle = this.getLibrary().tox_new(options, ref.NULL, size.deref(), errorPtr);

  var errorValue = errorPtr.deref();
  this._checkToxNewError(errorValue);
};

/**
 * Check the error value that may have been set by tox_new, and throw
 * the corresponding error (if any).
 * @priv
 * @param {Number} val - Error value to check
 * @todo Finish
 */
Tox.prototype._checkToxNewError = function(val) {
  if(val !== consts.TOX_ERR_NEW_OK) {
    throw (new Error('tox_new error: ' + val));
  }
};

/**
 * Get an Error depending on the error value set during tox_bootstrap.
 * If no Error, will return undefined.
 * @priv
 * @param {Number} val - Error value from tox_bootstrap
 * @return {Error} Error object if any
 */
Tox.prototype._getToxBootstrapError = function(val) {
  if(val !== consts.TOX_ERR_BOOTSTRAP_OK) {
    return (new Error('tox_bootstrap: ' + val));
  }
};

/**
 * Get the handle object.
 * @return {Object}
 */
Tox.prototype.getHandle = function() {
  return this._handle;
};

/**
 * Get the internal Library instance.
 * @return {ffi.Library}
 */
Tox.prototype.getLibrary = function() {
  return this._library;
};

/**
 * Asynchronous tox_bootstrap(3).
 * @param {String} address
 * @param {Number} port
 * @param {(Buffer|String)} publicKey
 * @todo Function for fixing all params, like Tox#_fixBootstrapParams(address, port, publicKey)
 * @todo Error function for res === false but no error
 */
Tox.prototype.bootstrap = function(address, port, publicKey, callback) {
  var _this = this,
      eptr = ref.alloc(_ToxErrorType);

  address = new Buffer(address + '\0');

  if(_.isString(publicKey)) {
    publicKey = (new Buffer(publicKey)).fromHex();
  }

  this.getLibrary().tox_bootstrap.async(this.getHandle(), address, port, publicKey, eptr, function(err, res) {
    var terr = _this._getToxBootstrapError(eptr.deref());
    if(!err && terr) {
      err = terr;
    }

    if(!err && res === false) {
      err = new Error('tox_bootstrap returned false but no error set at eptr');
    }

    if(callback) {
      callback(err);
    }
  });
};

/**
 * Synchronous tox_bootstrap(3).
 * @param {String} address
 * @param {Number} port
 * @param {(Buffer|String)} publicKey
 */
Tox.prototype.bootstrapSync = function(address, port, publicKey) {
  var eptr = ref.alloc(_ToxErrorType);

  address = new Buffer(address + '\0');

  if(_.isString(publicKey)) {
    publicKey = (new Buffer(publicKey)).fromHex();
  }

  var success = this.getLibrary().tox_bootstrap(this.getHandle(), address, port, publicKey, eptr);

  var terr = this._getToxBootstrapError(eptr.deref());
  if(terr) throw terr;

  if(success === false) {
    throw (new Error('tox_bootstrap returned false but no error set at eptr'));
  }
};

/**
 * Create a libtoxcore Library instance. If given a path, will use
 * the specified path.
 * @param {String} [libpath='libtoxcore'] - Path to libtoxcore
 * @return {ffi.Library}
 */
Tox.prototype.createLibrary = function(libpath) {
  libpath = libpath || 'libtoxcore';
  return ffi.Library(libpath, {
    'tox_add_tcp_relay':   [ 'bool', [ _ToxPtr, _Int8Ptr, 'uint16', _UInt8Ptr, _ToxErrorBootstrapPtr ] ],
    'tox_bootstrap':       [ 'bool', [ _ToxPtr, _Int8Ptr, 'uint16', _UInt8Ptr, _ToxErrorBootstrapPtr ] ],
    'tox_iteration_interval': [ 'uint32', [ _ToxPtr ] ],
    'tox_iterate':         [ 'void' , [ _ToxPtr ] ],
    'tox_kill': [ 'void',  [ _ToxPtr ] ],
    'tox_new':  [ _ToxPtr, [ _ToxOptionsPtr, _UInt8Ptr, 'size_t', _ToxErrorNewPtr ] ],
    'tox_get_savedata':    [ 'void',  [ _ToxPtr, _UInt8Ptr ] ],
    'tox_get_savedata_size':  [ 'size_t',  [ _ToxPtr ] ],
    'tox_options_default': [ 'void', [ _ToxOptionsPtr ] ],
    'tox_options_free':    [ 'void', [ _ToxOptionsPtr ] ],
    'tox_options_new':     [ _ToxOptionsPtr, [ _ToxOptionsErrorNewPtr ] ]
  });
};

/**
 * Check whether or not an iterateSync loop is running.
 * @return {Boolean} true if loop running, false if not
 */
Tox.prototype.isStarted = function() {
  return !!this._interval;
};

/**
 * Asynchronous tox_iteration_interval(3).
 * @param {Tox~numberCallback} [callback]
 */
Tox.prototype.iterationInterval = function(callback) {
  this.getLibrary().tox_iteration_interval.async(this.getHandle(), callback);
};

/**
 * Synchronous tox_iteration_interval(3).
 * @return {Number} milliseconds until the next tox_iterate should occur
 */
Tox.prototype.iterationIntervalSync = function() {
  return this.getLibrary().tox_iteration_interval(this.getHandle());
};

/**
 * Asynchronous tox_iterate(3).
 * @param {Tox~errorCallback} [callback]
 */
Tox.prototype.iterate = function(callback) {
  this.getLibrary().tox_iterate(this.getHandle(), callback);
};

/**
 * Synchronous tox_iterate(3).
 */
Tox.prototype.iterateSync = function() {
  this.getLibrary().tox_iterate(this.getHandle());
};

/**
 * Asynchronous tox_kill(3).
 * @param {Tox~errorCallback} [callback]
 */
Tox.prototype.kill = function(callback) {
  this.getLibrary().tox_kill.async(this.getHandle(), callback);
};

/**
 * Synchronous tox_kill(3).
 */
Tox.prototype.killSync = function() {
  this.getLibrary().tox_kill(this.getHandle());
};

/**
 * Start an interateSync loop using setInterval.
 * @param {Number} [wait] - Milliseconds to wait between iterateSync calls
 * @todo Maybe do one iterateSync(), then iterationIntervalSync(), and use that
 *       value as 'wait'?
 */
Tox.prototype.start = function(wait) {
  if(!this.isStarted()) {
    if(isNaN(wait) || wait <= 0) wait = 40; // Default milliseconds to wait
    this._interval = setInterval(Tox.prototype.iterateSync.bind(this), wait);
  }
};

/**
 * Stop the iterateSync loop if there is one running.
 */
Tox.prototype.stop = function() {
  if(this._interval) {
    clearInterval(this._interval);
    this._interval = undefined;
  }
};

/**
 * Callback that returns some error, if any.
 * @callback Tox~errorCallback
 * @param {Error} Error, if any
 */

/**
 * Callback that returns some some number.
 * @callback Tox~numberCallback
 * @param {Error} Error, if any
 * @param {Number} Value
 */

module.exports = Tox;