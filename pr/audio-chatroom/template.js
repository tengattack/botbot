import { tidy } from 'htmltidy2'
import { JSDOM } from 'jsdom'
import { escapeHTML } from '../../lib/common'

export const TABLE_ROW_TYPE = {
  NAME: 'name',
  TITLE: 'title',
  UAT: 'uat',
  PROD: 'prod',
  MSG: 'msg',
}

const TABLE_BODY_ID = 'PR-body-table-body'
const CHECKED_MARK = '✔️'

const DATA_TEMPLATE = [
  {
    class: TABLE_ROW_TYPE.NAME,
    header: 'author',
    render: (v) => (v.showName ? `@${v.name}` : ''),
    field: 'name',
  },
  {
    class: TABLE_ROW_TYPE.TITLE,
    header: '更新内容',
    render: (v) => v.title,
    field: 'title',
  },
  {
    class: TABLE_ROW_TYPE.UAT,
    header: 'UAT 测试通过',
    render: (v) => (v.uatChecked ? CHECKED_MARK : ''),
    field: 'uatChecked',
  },
  {
    class: TABLE_ROW_TYPE.PROD,
    header: '线上测试通过',
    render: (v) => (v.prodChecked ? CHECKED_MARK : ''),
    field: 'prodChecked',
  },
  {
    class: TABLE_ROW_TYPE.MSG,
    header: '备注',
    render: (v) => v.msg || '',
    field: 'msg',
  },
]

const createElement = (window, name) => window.document.createElement(name)

const createTableRow = (window, data) => {
  const tr = createElement(window, 'tr')

  DATA_TEMPLATE.forEach((v) => {
    const dom = createElement(window, 'td')
    dom.className = v.class
    dom.innerHTML = v.render(data)
    tr.appendChild(dom)
  })

  return tr
}

const createTableHeader = (window) => {
  const thead = createElement(window, 'thead')

  DATA_TEMPLATE.forEach((v) => {
    const dom = createElement(window, 'th')
    dom.className = v.class
    dom.innerHTML = v.header
    thead.appendChild(dom)
  })

  return thead
}

const formatHTML = async (html) =>
  new Promise((resolve, reject) => {
    tidy(html, { indent: true, 'show-body-only': 'yes' }, (e, r) => {
      if (e) {
        reject(e)
      }
      resolve(r)
    })
  })

const formatDOMToString = async (dom) => {
  const result = await formatHTML(dom.serialize())
  return result
}

const getFirstDOMInnerHTMLfromDOMArrayByClassName = (dom, className) => {
  if (!dom) {
    return ''
  }
  const DOMs = dom.getElementsByClassName(className)
  if (!DOMs || !DOMs.length) {
    return ''
  }
  return DOMs[0].innerHTML.trim()
}

const createTemplate = async (data, outputTableBodyDOM) => {
  const DOM = new JSDOM()
  const table = createElement(DOM.window, 'table')
  table.appendChild(createTableHeader(DOM.window))
  const tableBody = createElement(DOM.window, 'tbody')
  tableBody.id = TABLE_BODY_ID
  Object.values(data).forEach((list) =>
    list.forEach((v) => tableBody.appendChild(createTableRow(DOM.window, v)))
  )
  if (outputTableBodyDOM) {
    return tableBody.outerHTML
  }
  table.appendChild(tableBody)
  DOM.window.document.body.appendChild(table)
  const result = await formatDOMToString(DOM)
  return result
}

const BOOL_VALUE_TH = [TABLE_ROW_TYPE.UAT, TABLE_ROW_TYPE.PROD]

const parseTableRow = (dom) => {
  const map = {}
  const rows = dom.getElementsByTagName('tr')
  if (!rows.length) {
    return null
  }
  let lastName = ''
  for (let i = 0; i < rows.length; i++) {
    const row = rows.item(i)
    if (!row) {
      continue
    }
    const data = {}
    DATA_TEMPLATE.forEach((v) => {
      const value = getFirstDOMInnerHTMLfromDOMArrayByClassName(row, v.class)
      let result = value
      if (v.class === TABLE_ROW_TYPE.NAME) {
        if (value) {
          lastName = value
        }
        result = lastName
      } else if (BOOL_VALUE_TH.includes(v.class)) {
        result = !!value
      }
      data[v.field] = result
    })
    if (!map[data.name]) {
      map[data.name] = []
    }
    map[data.name].push(data)
  }
  return map
}

const updatePRDesc = (dom, data) => {
  const rows = dom.getElementsByTagName('tr')
  if (!rows.length) {
    return false
  }
  const rowMap = {}
  let lastName = ''
  for (let i = 0; i < rows.length; i++) {
    const row = rows.item(i)
    if (!row) {
      continue
    }
    const currentName = getFirstDOMInnerHTMLfromDOMArrayByClassName(row, TABLE_ROW_TYPE.NAME)
    if (currentName) {
      lastName = currentName
    }
    if (!rowMap[lastName]) {
      rowMap[lastName] = []
    }
    rowMap[lastName].push(row)
  }
  const targetCommits = rowMap[`@${data.name}`]
  if (!targetCommits) {
    return false
  }
  for (let i = 0; i < targetCommits.length; i++) {
    const titleDOM = targetCommits[i].getElementsByClassName(TABLE_ROW_TYPE.TITLE)
    if (titleDOM && titleDOM.length && titleDOM[0].innerHTML.trim() === escapeHTML(data.title)) {
      const msgDOM = targetCommits[i].getElementsByClassName(TABLE_ROW_TYPE.MSG)
      if (msgDOM && msgDOM.length && data.msg) {
        msgDOM[0].innerHTML = data.msg
      }
      const uatDOM = targetCommits[i].getElementsByClassName(TABLE_ROW_TYPE.UAT)
      if (uatDOM && uatDOM.length && typeof data.uatChecked === 'boolean') {
        uatDOM[0].innerHTML = data.uatChecked ? CHECKED_MARK : ''
      }
      const prodDOM = targetCommits[i].getElementsByClassName(TABLE_ROW_TYPE.PROD)
      if (prodDOM && prodDOM.length && typeof data.prodChecked === 'boolean') {
        prodDOM[0].innerHTML = data.prodChecked ? CHECKED_MARK : ''
      }
      return true
    }
  }
  return false
}

export const parseTemplate = async (data, body, isUpdateTableRow) => {
  if (!body) {
    if (isUpdateTableRow) {
      console.error('解析历史 PR body 失败，请确认 PR body 存在且符合解析规则')
      process.exit(1)
    }
    return createTemplate(data, false)
  }
  const DOM = new JSDOM(body)
  const container = DOM.window.document.body
  const tableBody = DOM.window.document.getElementById(TABLE_BODY_ID)
  if (!container || !tableBody) {
    if (isUpdateTableRow) {
      console.error('解析历史 PR body 失败，请确认 PR body 存在且符合解析规则')
      process.exit(1)
    }
    return createTemplate(data, false)
  }
  if (isUpdateTableRow) {
    const updated = updatePRDesc(tableBody, data)
    if (!updated) {
      console.error('未找到合适的更新对象，请确认 PR body 存在且符合解析规则')
      process.exit(1)
    }
    return formatDOMToString(DOM)
  }
  const oldData = parseTableRow(tableBody)
  if (oldData) {
    Object.keys(oldData).forEach((name) => {
      // 去除 @
      const list = data[name.substr(1)]
      if (!list) {
        return
      }
      const oldDataList = oldData[name]
      oldDataList.forEach((v) => {
        for (let i = 0; i < list.length; i++) {
          if (escapeHTML(list[i].title) === v.title) {
            list[i] = { ...list[i], ...v, name: list[i].name }
          }
        }
      })
    })
  }
  const table = await createTemplate(data, true)
  tableBody.outerHTML = table
  return formatDOMToString(DOM)
}
