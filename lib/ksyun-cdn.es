
import _ from 'lodash'
import url from 'url'
import request from 'request'
import fs from 'fs'
import qs from 'qs'

import { formatDate, formatTime, hmac_sha256, md5, sha256 } from './common'
import { USER_AGENT, TIMEOUT } from './const'

import config from '../config'

const endpoint = 'https://cdn.api.ksyun.com/'
const region = 'cn-beijing-6'

export default class KsyunCDN {
  constructor() {
    const c = config['ksyun_cdn']
    this.accessKeyId = c.accessKeyId
    this.accessKeySecret = c.accessKeySecret
    this.endpoint = endpoint
    this.region = region
  }
  formatDate(d, short = false) {
    if (short) {
      return formatDate(d)
    }
    return d.toISOString().replace(/([\-\:]|\.\d{3})/g, '')
  }
  encodeURI(str) {
    return encodeURIComponent(str).replace(/[!*()']/g, function (chr) {
      return '%' + chr.charCodeAt(0).toString(16).toUpperCase()
    })
  }
  signature(verb, uri, service, query, payload) {
    // https://docs.aws.amazon.com/general/latest/gr/sigv4_signing.html
    const algo = 'AWS4-HMAC-SHA256'
    const d = new Date()
    const datestrShort = this.formatDate(d, true)
    const datestr = this.formatDate(d)
    const credential = datestrShort + '/' + region + '/' + service + '/aws4_request'

    // side effects
    query.Version = '2016-09-01'

    // read from url
    const u = url.parse(uri)
    const host = u.host
    const headers = {
      'Host': host,
      'X-Amz-Date': datestr,
    }
    if (verb === 'POST') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }

    let strToSign = verb + '\n'
      + u.pathname + '\n'

    let keys = _.sortBy(Object.keys(query))
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      strToSign += key + '=' + this.encodeURI(query[key])
      if (i < keys.length - 1) {
        strToSign += '&'
      } else {
        // last
        strToSign += '\n'
      }
    }

    keys = _.sortBy(Object.keys(headers))
    let signedHeaders = ''
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      const lowercaseKey = key.toLowerCase()
      strToSign += lowercaseKey + ':' + headers[key].trim() + '\n'
      signedHeaders += lowercaseKey
      if (i < keys.length - 1) {
        signedHeaders += ';'
      }
    }
    strToSign += '\n'
    strToSign += signedHeaders + '\n'
    strToSign += sha256(payload)

    strToSign = algo + '\n'
      + datestr + '\n'
      + credential + '\n'
      + sha256(strToSign)

    const kDate = hmac_sha256('AWS4' + this.accessKeySecret, datestrShort, null)
    const kRegion = hmac_sha256(kDate, region, null)
    const kService = hmac_sha256(kRegion, service, null)
    const kSigning = hmac_sha256(kService, 'aws4_request', null)

    const sign = hmac_sha256(kSigning, strToSign)

    headers['Authorization'] = algo + ' Credential=' + this.accessKeyId + '/' + credential + ', SignedHeaders=' + signedHeaders + ', Signature=' + sign
    return headers
  }
  request(verb, uri, action, data, opts) {
    return new Promise((resolve, reject) => {
      let query
      if (verb === 'POST') {
        query = { Action: action }
        data = Buffer.from(qs.stringify(data))
      } else {
        // GET
        query = { Action: action, ...data }
        data = ''
      }
      const url = endpoint + uri
      const signature = this.signature(verb, url, 'cdn', query, data)
      opts = {
        method: verb,
        url,
        qs: query,
        ...opts,
        headers: {
          'Accept': 'application/json',
          'User-Agent': USER_AGENT,
          ...signature,
        },
        // json: true,
        gzip: true,
        timeout: TIMEOUT,
      }
      if (verb === 'POST') {
        opts.body = data
      }
      request(opts, (err, resp, body) => {
        if (err) {
          return reject('Ksyun API Error: ' + err.message)
        }
        try {
          body = JSON.parse(body)
          if (body.Error) {
            err = new Error('Ksyun API Error: (' + body.RequestId + ') ' + body.Error.Message)
            return reject(err)
          }
        } catch (e) {
          // PASS
        }
        if ([ 200, 204 ].includes(resp.statusCode)) {
          resolve(body)
        } else if (typeof body === 'string' && body.length < 20) {
          reject(new Error('Ksyun API Error: ' + body))
        } else {
          reject(new Error('Ksyun API Error: http status ' + resp.statusCode))
        }
      })
    })
  }
  setCertificate(domain, name, pubkey, privkey, certId = undefined) {
    return this.request('POST', '2016-09-01/cert/ConfigCertificate', 'ConfigCertificate', {
      Enable: 'on',
      DomainIds: domain,
      CertificateId: certId,
      CertificateName: name,
      ServerCertificate: pubkey,
      PrivateKey: privkey,
    })
  }
}
