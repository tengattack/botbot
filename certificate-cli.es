#!/usr/bin/env babel-node

import path from 'path'
import fs from 'fs'
import CDNClient from './lib/cdn'
import SLBClient from './lib/slb'
import config from './config'

function printHelpExit() {
  console.log('./certificate-cli.es [certificate_file] [private_key_file]')
  process.exit(1)
}

const args = {}
if (process.argv.length > 3) {
  args.certificate_file = process.argv[2]
  args.private_key_file = process.argv[3]
} else {
  printHelpExit()
}

const cdnHost = config['build'].cdn_host
const cdn = new CDNClient()
const slb = new SLBClient()

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

  let r = await cdn.setCertificate(cdnHost, name, pubk, privk)
  console.log('set cdn certificate done.')

  r = await slb.uploadCertificate(name, pubk, privk)

  if (r && r.ServerCertificateId) {
    const { ServerCertificateId } = r
    r = await slb.getLoadBalancers()
    for (const lb of r.LoadBalancers.LoadBalancer) {
      const _lb = await slb.getLoadBalancer(lb.LoadBalancerId)
      const pps = _lb.ListenerPortsAndProtocal.ListenerPortAndProtocal.filter(hasHttps)
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
  } else {
    console.log('slb upload certificate failed!', r)
  }

  console.log('done.')
}

function onerror(err) {
  console.error('Error:', err)
}

main().catch(onerror)
