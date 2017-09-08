'use strict'

const assert = require('assert')
const url = require('url')
const http = require('http')
const https = require('https')

const TIMEOUT_IN_MILLISECONDS = 30 * 1000

/**
* @function getResult
* @param {Object} timings
* @param {Number} timings.startAt
* @param {Number} timings.tcpConnectionAt
* @param {Number} timings.dnsLookupAt
* @param {Number|undefined} timings.tlsHandshakeAt
* @param {Number} timings.firstByteAt
* @param {Number} timings.endAt
* @return { dnsLookup, tcpConnection, tlsHandshake, firstByte, contentTransfer, total }
*/
function getResult (timings) {
  return {
    dnsLookup: timings.dnsLookupAt - timings.startAt,
    tcpConnection: timings.tcpConnectionAt - (timings.dnsLookupAt || timings.startAt),
    tlsHandshake: timings.tlsHandshakeAt !== undefined ? (timings.tlsHandshakeAt - timings.tcpConnectionAt) : undefined,
    firstByte: timings.firstByteAt - (timings.tlsHandshakeAt || timings.tcpConnectionAt),
    contentTransfer: timings.endAt - timings.firstByteAt,
    total: timings.endAt - timings.startAt
  }
}

/**
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
  assert(protocol, 'options.protocol is required')
  assert(hostname, 'options.hostname is required')
  assert(callback, 'callback is required')

  const timings = {
    startAt: Date.now(),
    dnsLookupAt: undefined,
    tcpConnectionAt: undefined,
    tlsHandshakeAt: undefined,
    firstByteAt: undefined,
    endAt: undefined
  }

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
}), (err, { timings }) => {
  console.log(timings)
})
