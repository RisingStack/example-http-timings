'use strict'

const assert = require('assert')
const url = require('url')
const http = require('http')
const https = require('https')

const TIMEOUT_IN_MILLISECONDS = 30 * 1000

/**
* Calculates HTTP timings
* @function getResult
* @param {Object} timings
* @param {Number} timings.startAt
* @param {Number|undefined} timings.dnsLookupAt
* @param {Number} timings.tcpConnectionAt
* @param {Number|undefined} timings.tlsHandshakeAt
* @param {Number} timings.firstByteAt
* @param {Number} timings.endAt
* @return { dnsLookup, tcpConnection, tlsHandshake, firstByte, contentTransfer, total }
*/
function getResult (timings) {
  return {
    // There is no DNS lookup with IP address
    dnsLookup: timings.dnsLookupAt !== undefined ? timings.dnsLookupAt - timings.startAt : timings.dnsLookupAt,
    tcpConnection: timings.tcpConnectionAt - (timings.dnsLookupAt || timings.startAt),
    // There is no TLS handshake without https
    tlsHandshake: timings.tlsHandshakeAt !== undefined ? (timings.tlsHandshakeAt - timings.tcpConnectionAt) : undefined,
    firstByte: timings.firstByteAt - (timings.tlsHandshakeAt || timings.tcpConnectionAt),
    contentTransfer: timings.endAt - timings.firstByteAt,
    total: timings.endAt - timings.startAt
  }
}

/**
* Creates a request and collects HTTP timings
* @function request
* @param {Object} options
* @param {String} [options.method='GET']
* @param {String} options.protocol
* @param {String} options.hostname
* @param {Number} [options.port]
* @param {String} [options.path]
* @param {Object} [options.headers={}]
* @param {String} [options.body]
* @param {Function} callback
*/
function request ({
  method = 'GET',
  protocol,
  hostname,
  port,
  path,
  headers = {},
  body
} = {}, callback) {
  // Validation
  assert(protocol, 'options.protocol is required')
  assert(['http:', 'https:'].includes(protocol), 'options.protocol must be one of: "http:", "https:"')
  assert(hostname, 'options.hostname is required')
  assert(callback, 'callback is required')

  // Initialization
  const timings = {
    startAt: Date.now(),
    dnsLookupAt: undefined,
    tcpConnectionAt: undefined,
    tlsHandshakeAt: undefined,
    firstByteAt: undefined,
    endAt: undefined
  }

  // Making request
  const req = (protocol.startsWith('https') ? https : http).request({
    protocol,
    method,
    hostname,
    port,
    path,
    headers
  }, (res) => {
    let responseBody = ''

    req.setTimeout(TIMEOUT_IN_MILLISECONDS)

    // Response events
    res.once('readable', () => {
      timings.firstByteAt = Date.now()
    })
    res.on('data', (chunk) => { responseBody += chunk })

    // End event is not emitted when stream is not consumed fully
    // in our case we consume it see: res.on('data')
    res.on('end', () => {
      timings.endAt = Date.now()

      callback(null, {
        headers: res.headers,
        timings: getResult(timings),
        body: responseBody
      })
    })
  })

  // Request events
  req.on('socket', (socket) => {
    socket.on('lookup', () => {
      timings.dnsLookupAt = Date.now()
    })
    socket.on('connect', () => {
      timings.tcpConnectionAt = Date.now()
    })
    socket.on('secureConnect', () => {
      timings.tlsHandshakeAt = Date.now()
    })
    socket.on('timeout', () => {
      req.abort()

      const err = new Error('ETIMEDOUT')
      err.code = 'ETIMEDOUT'
      callback(err)
    })
  })
  req.on('error', callback)

  // Sending body
  if (body) {
    req.write(body)
  }

  req.end()
}

// Getting timings
request(Object.assign(url.parse('https://api.github.com'), {
  headers: {
    'User-Agent': 'Example'
  }
}), (err, res) => {
  console.log(err || res.timings)
})
