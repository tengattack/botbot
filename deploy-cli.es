#!/usr/bin/env babel-node

import readline from 'readline'
import path from 'path'
import fs from 'fs-extra'
import _ from 'lodash'
import { spawnAsync } from './lib/common'
import DB from './lib/db'
import SLBClient from './lib/slb'
import ECSClient from './lib/ecs'
import config from './config'

function printHelpExit() {
  console.log('./deploy-cli.es [--weight=X] [--sql=X.sql] servers [script_file]')
  process.exit(1)
}

const availableOpts = { 'weight': 'int', 'sql': 'string' }
const args = {}
if (process.argv.length > 3) {
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i].startsWith('--')) {
      let opt = process.argv[i].substr(2)
      let value
      if (opt.indexOf('=') >= 0) {
        [ opt, value ] = opt.split('=')
      } else if (i + 1 < process.argv.length) {
        value = process.argv[++i]
      } else {
        console.error('missing option `%s` value', opt)
        printHelpExit()
      }
      const type = availableOpts[opt]
      switch (type) {
      case 'int':
        value = parseInt(value)
        if (isNaN(value)) {
          console.error('incorrect option `%s` value', opt)
          printHelpExit()
        }
        break
      case 'string':
        break
      default:
        console.error('unknown option `%s`', opt)
        printHelpExit()
      }
      args[opt] = value
    } else if (!args.servers) {
      args.servers = process.argv[i].split(',')
    } else {
      args.script_file = process.argv[i]
    }
  }
} else {
  printHelpExit()
}

const slb = new SLBClient()
const ecs = new ECSClient()

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

function messageWeight(r, newWeight, lbName, serverName, vServerGroupName) {
  if ('weight' in args) {
    // set weight
    if (vServerGroupName) {
      console.log('slb `' + lbName
        + '` set `' + serverName + '`\'s weight to ' + newWeight
        + ' from vserver `' + vServerGroupName + '` ' + (r ? 'succeeded' : 'failed') + '!')
    } else {
      console.log('slb `' + lbName
        + '` set `' + serverName + '`\'s weight to ' + newWeight
        + ' from backend servers ' + (r ? 'succeeded' : 'failed') + '!')
    }
  } else if (newWeight === 0) {
    if (vServerGroupName) {
      console.log('slb `' + lbName
        + '` remove `' + serverName
        + '` from vserver `' + vServerGroupName + '` ' + (r ? 'succeeded' : 'failed') + '!')
    } else {
      console.log('slb `' + lbName
        + '` remove `' + serverName
        + '` from backend servers ' + (r ? 'succeeded' : 'failed') + '!')
    }
  } else {
    // set back
    if (vServerGroupName) {
      console.log('slb `' + lbName + '` set `' + serverName
        + '` back to vserver `' + vServerGroupName + '` ' + (r ? 'succeeded' : 'failed') + '!')
    } else {
      console.log('slb `' + lbName + '` set `' + serverName
        + '` back to backend servers ' + (r ? 'succeeded' : 'failed') + '!')
    }
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

async function runScriptOnServers(args, stage) {
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

  let newWeight = 0
  if ('weight' in args) {
    newWeight = args.weight
  }
  for (const serverName of args.servers) {
    const dirtyLbs = []
    for (const lb of _lbs.LoadBalancers.LoadBalancer) {
      const _lb = lbs[lb.LoadBalancerId]
      const lbName = _lb.LoadBalancerName

      let dirty = false
      let backendServers = []
      _lb.BackendServers.BackendServer.forEach((s) => {
        if (('weight' in args || s.Weight > 0)
            && isServerMatch({ ...s, ServerName: ecses[s.ServerId] }, serverName)) {
          dirty = true
          backendServers.push({ ...s, Weight: newWeight })
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
        messageWeight(r, newWeight, lbName, serverName)
      }

      // vserver group
      const lbvg = lbvgs[lb.LoadBalancerId]
      for (const vg of lbvg.VServerGroups.VServerGroup) {
        const _vg = vgs[vg.VServerGroupId]
        // reset variables
        dirty = false
        backendServers = []
        _vg.BackendServers.BackendServer.forEach((s) => {
          if (('weight' in args || s.Weight > 0)
              && isServerMatch({ ...s, ServerName: ecses[s.ServerId] }, serverName)) {
            dirty = true
            backendServers.push({ ...s, Weight: newWeight })
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
          messageWeight(r, newWeight, lbName, serverName, vg.VServerGroupName)
        }
      }

      if (dirtyLb.BackendServers || dirtyLb.VServerGroups) {
        // add to set back queue
        dirtyLbs.push(dirtyLb)
      }
    }

    if (args.script_file) {
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
        let cmds
        r = await spawnAsync('scp', [ args.script_file, targetServer.ServerName + ':~/' + scriptFileName ])
        r = await spawnAsync('ssh', [ targetServer.ServerName, 'chmod', '+x', '~/' + scriptFileName ])
        cmds = [ targetServer.ServerName, '~/' + scriptFileName, serverName ]
        if (stage) {
          cmds.push(stage)
        }
        r = await spawnAsync('ssh', cmds)
        r = await spawnAsync('ssh', [ targetServer.ServerName, 'rm', '~/' + scriptFileName ])
      } catch (e) {
        hasErrors = true
        console.log(e)
        console.log('errors occurred.')
        throw e
      }
    }

    if ('weight' in args) {
      // weight setting mode
      // set weight & run script only
      continue
    }

    for (const lb of dirtyLbs) {
      const lbName = lb.LoadBalancerName

      if (lb.BackendServers) {
        // set back backend servers
        r = await slb.setBackendServers(lb.LoadBalancerId, lb.BackendServers.BackendServer)
        messageWeight(r, NaN, lbName, serverName)
      }

      if (lb.VServerGroups) {
        for (const vg of lb.VServerGroups) {
          // set back vserver backend servers
          r = await slb.setVServerGroupAttribute(vg.VServerGroupId, vg.VServerGroupName, vg.BackendServers.BackendServer)
          messageWeight(r, NaN, lbName, serverName, vg.VServerGroupName)
        }
      }
    }
  }
}

async function main() {
  await runScriptOnServers(args)

  if (args.sql) {
    const sql = await fs.readFile(args.sql, 'utf8')
    console.log('ready to import SQL:\n' + sql)

    let answer = await new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })
      rl.question('confirm to import? (y/n): ', function (ret) {
        rl.close()
        resolve(ret)
      })
    })
    answer = answer.trim()
    if (answer !== 'y') {
      console.log('user canceled sql import.')
    } else {
      const db = new DB({
        ...config['db'],
        multipleStatements: true,
      })
      try {
        const results = await db.query(sql)
        console.log('SQL results:')
        for (const result of results) {
          console.log(result.message)
        }
      } catch (e) {
        console.log('SQL query error:', e)
      }
      await db.close()
    }
  }

  console.log('done.')
}

function onerror(err) {
  console.error('Error:', err)
}

main().catch(onerror)
