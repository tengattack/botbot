#!/usr/bin/env babel-node

import _ from 'lodash'
import ECSClient from './lib/ecs'
import SLBClient from './lib/slb'

const slb = new SLBClient()
const ecs = new ECSClient()

function printHelpExit() {
  console.log('./find-slb-node.es [node_name]')
  process.exit(1)
}

const focusNodeName = process.argv[2]

if (!focusNodeName) {
  printHelpExit()
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

  for (const lb of _lbs.LoadBalancers.LoadBalancer) {
    const _lb = lbs[lb.LoadBalancerId]
    // get server ids from backend servers
    _lb.BackendServers.BackendServer.forEach((s) => {
      if (ecses[s.ServerId] === focusNodeName) {
        console.log(lb.LoadBalancerName + ' has the node (weight: ' + s.Weight + ')')
      }
    })

    const vServerGroups = lbvgs[lb.LoadBalancerId]
    for (const vServerGroup of vServerGroups.VServerGroups.VServerGroup) {
      const _vg = vgs[vServerGroup.VServerGroupId]
      // ger server ids from vserver groups
      _vg.BackendServers.BackendServer.forEach((s) => {
        if (ecses[s.ServerId] === focusNodeName) {
          console.log(lb.LoadBalancerName + '\'s vServerGroup: ' + _vg.VServerGroupName + ' has the node (weight: ' + s.Weight + ')')
        }
      })
    }
  }

  //console.log(ecses)
}

function onerror(err) {
  console.error('Error:', err)
  process.exit(1)
}

main().catch(onerror)
