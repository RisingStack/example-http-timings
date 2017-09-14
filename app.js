'use strict'

const assert = require('assert')
const url = require('url')
const http = require('http')
const https = require('https')

const TIMEOUT_IN_MILLISECONDS = 30 * 1000
const NS_PER_SEC = 1e9
const MS_PER_NS = 1e6

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
  const eventTimes = {
    // use process.hrtime() as it's not a subject of clock drift
    startAt: process.hrtime(),
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
      eventTimes.firstByteAt = process.hrtime()
    })
    res.on('data', (chunk) => { responseBody += chunk })

    // End event is not emitted when stream is not consumed fully
    // in our case we consume it see: res.on('data')
    res.on('end', () => {
      eventTimes.endAt = process.hrtime()

      callback(null, {
        headers: res.headers,
        timings: getTimings(eventTimes),
        body: responseBody
      })
    })
  })

  // Request events
  req.on('socket', (socket) => {
    socket.on('lookup', () => {
      eventTimes.dnsLookupAt = process.hrtime()
    })
    socket.on('connect', () => {
      eventTimes.tcpConnectionAt = process.hrtime()
    })
    socket.on('secureConnect', () => {
      eventTimes.tlsHandshakeAt = process.hrtime()
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

/**
* Calculates HTTP timings
* @function getTimings
* @param {Object} eventTimes
* @param {Number} eventTimes.startAt
* @param {Number|undefined} eventTimes.dnsLookupAt
* @param {Number} eventTimes.tcpConnectionAt
* @param {Number|undefined} eventTimes.tlsHandshakeAt
* @param {Number} eventTimes.firstByteAt
* @param {Number} eventTimes.endAt
* @return {Object} timings - { dnsLookup, tcpConnection, tlsHandshake, firstByte, contentTransfer, total }
*/
function getTimings (eventTimes) {
  return {
    // There is no DNS lookup with IP address
    dnsLookup: eventTimes.dnsLookupAt !== undefined ?
      getHrTimeDurationInMs(eventTimes.startAt, eventTimes.dnsLookupAt) : undefined,
    tcpConnection: getHrTimeDurationInMs(eventTimes.dnsLookupAt || eventTimes.startAt, eventTimes.tcpConnectionAt),
    // There is no TLS handshake without https
    tlsHandshake: eventTimes.tlsHandshakeAt !== undefined ?
      (getHrTimeDurationInMs(eventTimes.tcpConnectionAt, eventTimes.tlsHandshakeAt)) : undefined,
    firstByte: getHrTimeDurationInMs((eventTimes.tlsHandshakeAt || eventTimes.tcpConnectionAt), eventTimes.firstByteAt),
    contentTransfer: getHrTimeDurationInMs(eventTimes.firstByteAt, eventTimes.endAt),
    total: getHrTimeDurationInMs(eventTimes.startAt, eventTimes.endAt)
  }
}

/**
* Get duration in milliseconds from process.hrtime()
* @function getHrTimeDurationInMs
* @param {Array} startTime - [seconds, nanoseconds]
* @param {Array} endTime - [seconds, nanoseconds]
* @return {Number} durationInMs
*/
function getHrTimeDurationInMs (startTime, endTime) {
  const secondDiff = endTime[0] - startTime[0]
  const nanoSecondDiff = endTime[1] - startTime[1]
  const diffInNanoSecond = secondDiff * NS_PER_SEC + nanoSecondDiff

  return diffInNanoSecond / MS_PER_NS
}

// Getting timings
request(Object.assign(url.parse('https://api.github.com'), {
  headers: {
    'User-Agent': 'Example'
  }
}), (err, res) => {
  console.log(err || res.timings)
})
