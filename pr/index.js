#!/usr/bin/env babel-node

import { ArgumentParser } from 'argparse'
import { FMAction } from './audio-chatroom'

const UPSTREAM_OWNER = 'MiaoSiLa'

const ACTIONS_TYPE = {
  CREATE: 'create',
  UPDATE: 'update',
}

const ACTION_MAP = {
  [`${UPSTREAM_OWNER}/audio-chatroom`]: {
    [ACTIONS_TYPE.CREATE]: FMAction.createPR,
    [ACTIONS_TYPE.UPDATE]: FMAction.updatePR,
  },
  [`Aokoooooo/aoko-cli-test`]: {
    [ACTIONS_TYPE.CREATE]: FMAction.createPR,
    [ACTIONS_TYPE.UPDATE]: FMAction.updatePR,
  },
}

const parser = new ArgumentParser({
  addHelp: true,
  description: 'Auto create & update PR',
})

parser.addArgument(['action'], {
  help: 'The action you want to do, create or update',
})
parser.addArgument(['-P', '--project'], {
  help: 'Specify project, eg. tengattack/botbot',
})
parser.addArgument(['-v', '--version'], {
  help: 'The new version of the project',
  isOptional: true,
})
parser.addArgument(['--id'], {
  help: 'The ID of the pull request',
  isOptional: true,
})

const args = parser.parseArgs()

const onArgsError = () => {
  parser.exit(1, 'No enough arguments\n\n' + parser.formatUsage())
}

if (!args.project || !args.action || !Object.values(ACTIONS_TYPE).includes(args.action)) {
  onArgsError()
}
if (args.action === ACTIONS_TYPE.UPDATE && !args.id) {
  onArgsError()
}

ACTION_MAP[args.project][args.action](args)
