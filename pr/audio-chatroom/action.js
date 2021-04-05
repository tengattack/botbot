import path from 'path'
import fs from 'fs'
import day from 'dayjs'
import { spawnAsync } from '../../lib/common'
import Client from '../../lib/github'
import config from '../../config'
import { parseTemplate } from './template'

const UPSTREAM_OWNER = 'MiaoSiLa'
const REPO_NAME = 'audio-chatroom'
// const UPSTREAM_OWNER = 'Aokoooooo'
// const REPO_NAME = 'aoko-cli-test'
const GIT_LOG_SPLIT_TAG = ' || '

let github
let user
const repoPath = path.join(config.github['repo_path'], REPO_NAME)

const init = async () => {
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

const afterPRUpdated = async (data, newVersion) => {
  await init()
  const commits = (
    await spawnAsync(
      'git',
      ['log', 'upstream/stable...HEAD', `--pretty=format:%an${GIT_LOG_SPLIT_TAG}%s`],
      { cwd: repoPath }
    )
  ).stdout.split('\n')
  const groupedCommits = {}
  commits.forEach((v) => {
    const [login, msg] = v.split(GIT_LOG_SPLIT_TAG)
    if (login === user.login || !msg.startsWith('frontend')) {
      return
    }
    if (!groupedCommits[login]) {
      groupedCommits[login] = []
    }
    groupedCommits[login].push(msg)
  })
  const commitUsers = Object.keys(groupedCommits)
  const oldReviewers = (data.requested_reviewers || []).map((v) => v.login).filter((v) => v)
  const diffReviewers = oldReviewers
    .reduce(
      (x, y) => {
        const index = x.indexOf(y)
        if (index > -1) {
          x.splice(index, 1)
        }
        return x
      },
      [...commitUsers]
    )
    .filter((v) => v !== user.login)
  if (diffReviewers.length) {
    console.log('\n同步 reviewer 中……')
    try {
      await github.requestReviewers(UPSTREAM_OWNER, REPO_NAME, data.number, {
        reviewers: diffReviewers,
      })
      console.log('reviewer 同步成功')
    } catch (e) {
      console.log(e)
      console.log('reviewer 同步失败')
    }
  }
  console.log('更新 PR 信息中……')
  const baseBodyDataMap = {}
  Object.keys(groupedCommits).forEach((name) => {
    groupedCommits[name].forEach((title, i) => {
      const baseBodyData = {
        name,
        title,
        showName: i === 0,
        uatChecked: false,
        prodChecked: false,
      }
      if (!baseBodyDataMap[name]) {
        baseBodyDataMap[name] = []
      }
      baseBodyDataMap[name].push(baseBodyData)
    })
  })
  let versionChanged = false
  if (newVersion) {
    if (/^(\d+\.)*\d$/.test(newVersion)) {
      const pkgPath = `${repoPath}/package.json`
      const pkg = JSON.parse(fs.readFileSync(pkgPath).toString())
      const oldVersion = pkg.version
      if (oldVersion !== newVersion) {
        pkg.version = newVersion
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, undefined, 2))
        await spawnAsync('git', ['add', '.'], { cwd: repoPath })
        await spawnAsync('git', ['commit', '-m', `version: ${oldVersion} => ${newVersion}`], {
          cwd: repoPath,
        })
        await spawnAsync('git', ['push'], { cwd: repoPath })
        versionChanged = true
      }
    } else {
      console.log(`version 格式有误，需满足 /^(\d+\.)*\d$/（${newVersion}）`)
    }
  }
  const titleMatch = /^(.*)([\(（].*[\)）])$/.exec(data.title)
  const titleSuffix = newVersion && versionChanged ? `（${newVersion}）` : ''
  const newTitle =
    titleMatch && titleMatch[1] && versionChanged
      ? `${titleMatch[1]}${titleSuffix}`
      : `${data.title}${titleSuffix}`
  await github.updatePullRequest(UPSTREAM_OWNER, REPO_NAME, data.number, {
    body: await parseTemplate(baseBodyDataMap, data.body),
    title: newTitle,
  })
  console.log(`PR#${data.number} 同步成功`)
}

export const createPR = async (newVersion) => {
  await init()
  const branchName = `PR-${day().format('YYYY-MM-DD')}`
  await spawnAsync('git', ['fetch', 'upstream'], { cwd: repoPath })
  await spawnAsync('git', ['checkout', '-f', '-b', branchName, 'upstream/master'], {
    cwd: repoPath,
  })
  await spawnAsync('git', ['push', '-u', 'origin', branchName], { cwd: repoPath })
  console.log('创建 PR 中……')
  const pull = await github.createPullRequest(UPSTREAM_OWNER, REPO_NAME, {
    title: 'frontend: 将 master 最新提交合并至 stable 分支',
    head: `${user.login}:${branchName}`,
    base: 'stable',
  })
  console.log(`PR#${pull.number} 创建成功`)
  await afterPRUpdated(pull, newVersion)
}

export const updatePR = async (branchName, newVersion) => {
  await init()
  await spawnAsync('git', ['checkout', '-f', branchName], { cwd: repoPath })
  await spawnAsync('git', ['fetch', 'upstream'], { cwd: repoPath })
  await spawnAsync('git', ['merge', 'upstream/master'], { cwd: repoPath })
  await spawnAsync('git', ['push'], { cwd: repoPath })
  console.log('查询 PR 中……')
  const pulls = await github.listPullRequests(UPSTREAM_OWNER, REPO_NAME, {
    head: `${user.login}:${branchName}`,
  })
  if (!pulls || !pulls.length) {
    throw new Error(`未找到 ${user.login} 为仓库 ${REPO_NAME} 创建的 PR (分支：${branchName})`)
  }
  await afterPRUpdated(pulls[0], newVersion)
}
