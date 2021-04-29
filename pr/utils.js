import path from 'path'
import day from 'dayjs'
import { spawnAsync } from '../lib/common'
import Client from '../lib/github'
import config from '../config'

let github
let user
const baseRepoPath = config.github['repo_path']

export const getRepoPath = (project) => path.join(baseRepoPath, project)

export const getRepoName = (project) => project.split('/')[1]

export const initClient = async () => {
  if (github && user) {
    return { github, user }
  }
  github = new Client({
    access_token: config.github.access_token,
    proxy: config.github.proxy,
  })
  user = await github.getAuthenticatedUser()
  return { github, user }
}

export const beforeCreatePR = async (repoName) => {
  const repoPath = getRepoPath(repoName)
  const branchName = `PR-${day().format('YYYY-MM-DD')}`
  await spawnAsync('git', ['fetch', 'upstream'], { cwd: repoPath })
  await spawnAsync('git', ['checkout', '-f', '-b', branchName, 'upstream/master'], {
    cwd: repoPath,
  })
  await spawnAsync('git', ['push', '-u', 'origin', branchName], { cwd: repoPath })
  return branchName
}

export const beforeUpdatePR = async (project, id) => {
  const { github, user } = await initClient()
  const repoName = getRepoName(project)
  const repoPath = getRepoPath(repoName)
  console.log('检查 PR 中……')
  const pull = await github.getPullRequest(project, id)
  if (!pull) {
    throw new Error(`未找到 ${user.login} 为仓库 ${repoName} 创建的 PR (#${id})`)
  }
  // 要求 repo 里的 branchName(pull request head ref) 和本地的相同，且本地存在该分支
  // 正常操作是没有问题的
  await spawnAsync('git', ['checkout', '-f', pull.head.ref], { cwd: repoPath })
  await spawnAsync('git', ['fetch', 'upstream'], { cwd: repoPath })
  await spawnAsync('git', ['merge', 'upstream/master'], { cwd: repoPath })
  await spawnAsync('git', ['push'], { cwd: repoPath })
}
