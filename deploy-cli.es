#!/usr/bin/env babel-node

import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import _ from 'lodash'
import SLBClient from './lib/slb'
import ECSClient from './lib/ecs'
import config from './config'

function printHelpExit() {
  console.log('./deploy-cli.es [servers] [script_file]')
  process.exit(1)
}

const args = {}
if (process.argv.length > 3) {
  args.servers = process.argv[2].split(',')
  args.script_file = process.argv[3]
} else {
  printHelpExit()
}

const slb = new SLBClient()
const ecs = new ECSClient()

function hasHttps(pp) {
  if (pp.ListenerProtocal === 'https') {
    return true
  }
}

function isServerMatch(s, name) {
  const np = name.split(':')
  if (s.ServerName === np[0]) {
    // server name match
    if (np.length > 1) {
      // name with port
      if (s.Port === parseInt(np[1])) {
        // port matched
        return true
      }
    } else {
      // only server name
      return true
    }
  }
  return false
}

function wait(t) {
  return new Promise((resolve) => {
    setTimeout(resolve, t)
  })
}

function spawnAsync(command, args, opts) {
  return new Promise((resolve, reject) => {
    const cmd = spawn(command, args, opts)
    let stdout = ''
    let stderr = ''
    cmd.stdout.on('data', (data) => {
      process.stdout.write(data)
      stdout += data.toString()
    })
    cmd.stderr.on('data', (data) => {
      process.stdout.write(data)
      stderr += data.toString()
    })
    cmd.on('close', (code) => {
      const ret = {
        code,
        stdout,
        stderr,
      }
      if (code === 0) {
        resolve(ret)
      } else {
        reject(ret)
      }
    })
  })
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
  let serverIds = []
  const ecses = {}
  const lbs = {}
  const lbvgs = {}
  const vgs = {}

  // get servers info
  const _lbs = await slb.getLoadBalancers()
  for (const lb of _lbs.LoadBalancers.LoadBalancer) {
    const _lb = await slb.getLoadBalancer(lb.LoadBalancerId)
    lbs[lb.LoadBalancerId] = _lb
    // get server ids from backend servers
    _lb.BackendServers.BackendServer.forEach((s) => {
      serverIds.push(s.ServerId)
    })

    const vServerGroups = await slb.getVServerGroups(lb.LoadBalancerId)
    lbvgs[lb.LoadBalancerId] = vServerGroups
    for (const vServerGroup of vServerGroups.VServerGroups.VServerGroup) {
      const _vg = await slb.getVServerGroupAttribute(vServerGroup.VServerGroupId)
      vgs[vServerGroup.VServerGroupId] = _vg
      // ger server ids from vserver groups
      _vg.BackendServers.BackendServer.forEach((s) => {
        serverIds.push(s.ServerId)
      })
    }
  }

  serverIds = _.uniq(serverIds)
  let p = 0
  let r
  do {
    r = await ecs.getInstances(serverIds, ++p)
    r.Instances.Instance.forEach((s) => {
      ecses[s.InstanceId] = s.InstanceName
    })
  } while (p * r.PageSize < r.TotalCount)

  for (const serverName of args.servers) {
    const dirtyLbs = []
    for (const lb of _lbs.LoadBalancers.LoadBalancer) {
      const _lb = lbs[lb.LoadBalancerId]
      const lbName = _lb.LoadBalancerName

      let dirty = false
      let backendServers = []
      _lb.BackendServers.BackendServer.forEach((s) => {
        if (s.Weight > 0 && isServerMatch({ ...s, ServerName: ecses[s.ServerId] }, serverName)) {
          dirty = true
          backendServers.push({ ...s, Weight: 0 })
        } else {
          backendServers.push(s)
        }
      })
      let dirtyLb = {
        LoadBalancerId: lb.LoadBalancerId,
        LoadBalancerName: lb.LoadBalancerName,
      }
      if (dirty) {
        dirtyLb.BackendServers = _lb.BackendServers
        r = await slb.setBackendServers(lb.LoadBalancerId, backendServers)
        if (!r) {
          console.log('slb `' + lbName + '` remove `' + serverName + '` from load balancer failed!')
        } else {
          console.log('slb `' + lbName + '` remove `' + serverName + '` from load balancer succeeded!')
        }
      }

      // vserver group
      const lbvg = lbvgs[lb.LoadBalancerId]
      for (const vg of lbvg.VServerGroups.VServerGroup) {
        const _vg = vgs[vg.VServerGroupId]
        // reset variables
        dirty = false
        backendServers = []
        _vg.BackendServers.BackendServer.forEach((s) => {
          if (s.Weight > 0 && isServerMatch({ ...s, ServerName: ecses[s.ServerId] }, serverName)) {
            dirty = true
            backendServers.push({ ...s, Weight: 0 })
          } else {
            backendServers.push(s)
          }
        })
        if (dirty) {
          if (!dirtyLb.VServerGroups) {
            dirtyLb.VServerGroups = []
          }
          dirtyLb.VServerGroups.push({
            VServerGroupId: vg.VServerGroupId,
            VServerGroupName: _vg.VServerGroupName,
            BackendServers: _vg.BackendServers,
          })
          r = await slb.setVServerGroupAttribute(vg.VServerGroupId, vg.VServerGroupName, backendServers)
          if (!r) {
            console.log('slb `' + lbName + '` vserver `' + vg.VServerGroupName + '` remove `' + serverName + '` from load balancer failed!')
          } else {
            console.log('slb `' + lbName + '` vserver `' + vg.VServerGroupName + '` remove `' + serverName + '` from load balancer succeeded!')
          }
        }
      }

      if (dirtyLb.BackendServers || dirtyLb.VServerGroups) {
        // add to set back queue
        dirtyLbs.push(dirtyLb)
      }
    }

    let hasErrors = false
    console.log('start running script on `' + serverName + '`')
    try {
      const scriptFileName = path.basename(args.script_file)
      if (scriptFileName.includes(' '))  {
        throw new Error("script name has spaces")
      }
      const targetServer = {}
      if (serverName.indexOf(':') >= 0) {
        const t = serverName.split(':')
        targetServer.ServerName = t[0]
        targetServer.Port = parseInt(t[1])
      } else {
        targetServer.ServerName = serverName
      }
      console.log('$ scp "%s" %s:%s', args.script_file, targetServer.ServerName, '~/' + scriptFileName)
      r = await spawnAsync('scp', [ args.script_file, targetServer.ServerName + ':~/' + scriptFileName ])
      console.log('$ ssh "%s" chmod +x %s', targetServer.ServerName, '~/' + scriptFileName)
      r = await spawnAsync('ssh', [ targetServer.ServerName, 'chmod', '+x', '~/' + scriptFileName ])
      console.log('$ ssh "%s" %s "%s"', targetServer.ServerName, '~/' + scriptFileName, serverName)
      r = await spawnAsync('ssh', [ targetServer.ServerName, '~/' + scriptFileName, serverName ])
      console.log('$ ssh "%s" rm %s', targetServer.ServerName, '~/' + scriptFileName)
      r = await spawnAsync('ssh', [ targetServer.ServerName, 'rm', '~/' + scriptFileName ])
    } catch (e) {
      hasErrors = true
      console.log(e)
      console.log('errors occurred.')
      return
    }

    for (const lb of dirtyLbs) {
      const lbName = lb.LoadBalancerName

      if (lb.BackendServers) {
        // set back backend servers
        r = await slb.setBackendServers(lb.LoadBalancerId, lb.BackendServers.BackendServer)
        if (!r) {
          console.log('slb `' + lbName + '` set back failed!')
        } else {
          console.log('slb `' + lbName + '` set back succeeded!')
        }
      }

      if (lb.VServerGroups) {
        for (const vg of lb.VServerGroups) {
          // set back vserver backend servers
          r = await slb.setVServerGroupAttribute(vg.VServerGroupId, vg.VServerGroupName, vg.BackendServers.BackendServer)
          if (!r) {
            console.log('slb `' + lbName + '` vserver `' + vg.VServerGroupName + '` set back failed!')
          } else {
            console.log('slb `' + lbName + '` vserver `' + vg.VServerGroupName + '` set back succeeded!')
          }
        }
      }
    }
  }

  console.log('done.')
}

function onerror(err) {
  console.error('Error:', err)
}

main().catch(onerror)
