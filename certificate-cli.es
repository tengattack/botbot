#!/usr/bin/env babel-node

import path from 'path'
import fs from 'fs'
import minimatch from 'minimatch'
import CDNClient from './lib/cdn'
import LiveCDNClient from './lib/livecdn'
import SLBClient from './lib/slb'
import KsyunCDN from './lib/ksyun-cdn'
import config from './config'

function printHelpExit() {
  console.log('./certificate-cli.es [certificate_file] [private_key_file] [domain_name]')
  process.exit(1)
}

const args = {}
if (process.argv.length > 3) {
  args.certificate_file = process.argv[2]
  args.private_key_file = process.argv[3]
  args.domain_name = process.argv[4]
} else {
  printHelpExit()
}

const cdnHost = config['build'].cdn_host
const cdn = new CDNClient()
const livecdn = new LiveCDNClient()
const slb = new SLBClient()
const ksyunCdn = new KsyunCDN()

function ii(s, len = 2, pad = '0') {
  s = s.toString()
  while (s.length < len) {
    s = pad + s
  }
  return s
}

function formatTime(d) {
  d = new Date(d)
  return `${d.getFullYear()}${ii(d.getMonth() + 1)}${ii(d.getDate())}`
}

function hasHttps(pp) {
  if (pp.ListenerProtocal === 'https') {
    return true
  }
}

function getPropertites(d, properties, check) {
  const r = {}
  for (const prop of properties) {
    const u = typeof d[prop] === 'undefined'
    if (check && u) {
      throw new Error('property `' + prop + '` not exists')
    }
    if (!u) {
      r[prop] = d[prop]
    }
  }
  return r
}

async function main() {
  const d = new Date()
  const name = 'cert-' + formatTime(d)

  const pubk = fs.readFileSync(args.certificate_file)
  const privk = fs.readFileSync(args.private_key_file)

  // update ksyun cdn
  if (args.domain_name && config['ksyun_cdn'].domainList) {
    for (const domain of config['ksyun_cdn'].domainList) {
      if (args.domain_name === domain.domainName) {
        let certId = null
        for (const domainId of domain.domainIds) {
          let r
          if (certId) {
            r = await ksyunCdn.setCertificate(domainId, undefined, undefined, undefined, certId)
          } else {
            r = await ksyunCdn.setCertificate(domainId, name, pubk, privk)
          }
          if (r && r.CertificateId) {
            certId = r.CertificateId
          }
          console.log('set ksyun cdn \'' + domainId + '\' certificate done.')
        }
      }
    }
  }

  let r
  let page = 1
  while (true) {
    const res = await livecdn.listDomains(page)
    for (const domain of res.Domains.PageData) {
      if (domain.LiveDomainType !== 'liveVideo') {
        continue
      }
      if (args.domain_name && args.domain_name !== domain.DomainName) {
        continue
      }
      try {
        r = await livecdn.setCertificate(domain.DomainName, name, pubk, privk)
      } catch (e) {
        if (e.code === 'Certificate.Duplicated') {
          r = await livecdn.setCertificate(domain.DomainName, name, undefined, undefined)
        } else {
          console.error('live cdn \'' + domain.DomainName + '\' set certificate failed.')
          throw e
        }
      }
      console.log('set live cdn \'' + domain.DomainName + '\' certificate done.')
    }
    page++
    if (page > Math.floor(res.TotalCount / res.PageSize)) {
      break
    }
  }

  page = 1
  while (true) {
    const res = await cdn.listDomains(page)
    for (const domain of res.Domains.PageData) {
      if (domain.SslProtocol === 'on') {
        if (args.domain_name
            && args.domain_name !== domain.DomainName
            && !minimatch(domain.DomainName, args.domain_name)) {
          continue
        }
        try {
          r = await cdn.setCertificate(domain.DomainName, name, pubk, privk, 'cas')
        } catch (e) {
          if (e.code === 'Certificate.Duplicated') {
            // as we have uploaded to Aliyun CAS, we can set it using CertName directly
            r = await cdn.setCertificate(domain.DomainName, name, undefined, undefined, 'cas')
          } else {
            console.error('cdn \'' + domain.DomainName + '\' set certificate failed.')
            throw e
          }
        }
        console.log('set cdn \'' + domain.DomainName + '\' certificate done.')
      }
    }
    page++
    if (page > Math.floor(res.TotalCount / res.PageSize)) {
      break
    }
  }

  let ServerCertificateId
  r = await slb.getLoadBalancers()
  const lbs = r.LoadBalancers
  for (const lb of lbs.LoadBalancer) {
    const _lb = await slb.getLoadBalancer(lb.LoadBalancerId)
    const pps = _lb.ListenerPortsAndProtocal.ListenerPortAndProtocal.filter(hasHttps)
    let skip = args.domain_name ? true : false
    for (const t of lb.Tags.Tag) {
      if (t.TagKey === 'domain' && args.domain_name && args.domain_name === t.TagValue) {
        skip = false  // ignore skip tag, must be matched exactly
        break
      }
      if (t.TagKey === 'certificate-cli' && t.TagValue === 'skip') {
        skip = true
      }
    }
    if (skip) {
      continue
    }

    if (!ServerCertificateId) {
      r = await slb.uploadCertificate(name, pubk, privk)
      if (r && r.ServerCertificateId) {
        ServerCertificateId = r.ServerCertificateId
      } else {
        console.log('slb upload certificate failed!', r)
        throw new Error('slb upload certificate failed!')
      }
    }

    for (const pp of pps) {
      r = await slb.getLoadBalancerAttribute(lb.LoadBalancerId, pp.ListenerProtocal, pp.ListenerPort)
      let opts = getPropertites(r, [
        'Bandwidth',
        'XForwardedFor',
        'Scheduler',
        'StickySession',
        // 'StickySessionType',
        // 'CookieTimeout',
        // 'Cookie',
        'HealthCheck',
        // 'HealthCheckDomain',
        // 'HealthCheckURI',
        // 'HealthCheckConnectPort',
        // 'HealthyThreshold',
        // 'UnhealthyThreshold',
        // 'HealthCheckTimeout',
        // 'HealthCheckInterval',
        // 'HealthCheckHttpCode',
        // 'ServerCertificateId',
        // 'CACertificateId',
      ], true)
      opts.ServerCertificateId = ServerCertificateId
      if (opts.StickySession === 'on') {
        opts = { ...opts, ...getPropertites(r, [
          'StickySessionType',
          'CookieTimeout',
          'Cookie',
        ]) }
      }
      if (opts.HealthCheck === 'on') {
        opts = { ...opts, ...getPropertites(r, [
          'HealthCheckDomain',
          'HealthCheckURI',
          'HealthCheckConnectPort',
          'HealthyThreshold',
          'UnhealthyThreshold',
          'HealthCheckTimeout',
          'HealthCheckInterval',
          'HealthCheckHttpCode',
        ]) }
      }
      opts = { ...opts, ...getPropertites(r, [
        'VServerGroup',
        'VServerGroupId',
        'Gzip',
      ]) }
      r = await slb.setLoadBalancerAttribute(lb.LoadBalancerId, pp.ListenerProtocal, pp.ListenerPort, opts)
      if (!r) {
        console.log('slb set `' + lb.LoadBalancerName + '` certificate failed!')
      } else {
        console.log('slb set `' + lb.LoadBalancerName + '` certificate -> ' + ServerCertificateId)
      }
    }
  }

  console.log('done.')
}

function onerror(err) {
  console.error('Error:', err)
}

main().catch(onerror)
