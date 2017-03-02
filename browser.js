const system = require('system')
const fs = require('fs')
const page = require('webpage').create()

const PAGES_PATH = './pages'
const SCROLL_DONE = 'SCROLL_DONE'
var pageUrl
var pageName
var opts = {}

function exitAndPrintUsage() {
  console.log('Usage:\n'
    + '\tphantomjs index.js [options] [url] [name]')
  phantom.exit()
}

if (system.args.length < 3) {
  exitAndPrintUsage()
} else {
  for (var i = 1; i < system.args.length; i++) {
    var arg = system.args[i]
    if (arg.substr(0, 2) === '--') {
      var opt = arg.substr(2)
      if (opt === 'mobile') {
        opts.mobileView = true
      } else if (opt === 'screenshot') {
        opts.screenshot = true
      }
    } else {
      if (!pageUrl) {
        pageUrl = system.args[i]
      } else {
        pageName = system.args[i]
      }
    }
  }
  if (!pageUrl || !pageName) {
    exitAndPrintUsage()
  } else {
    console.log('url:', pageUrl)
    console.log('name:', pageName)
    // console.log('mobileView:', opts.mobileView)
  }
}

function onError(status) {
  console.log('error', status)
  phantom.exit()
}

if (opts.mobileView) {
  // iPhone 6
  page.viewportSize = { width: 375 * 2, height: 667 * 2 }
  page.zoomFactor = 2
} else {
  page.viewportSize = { width: 1920, height: 1080 }
}
page.onConsoleMessage = function (msg) {
  console.log('console message: ' + msg)
}
page.onCallback = function (data) {
  if (data === SCROLL_DONE) {
    console.log('scroll done')
  }
}

var t_net = null
var page_ready = false

function onNetworkFinish() {
  console.log('network silent')
  fs.write(PAGES_PATH + '/' + pageName + '.html', page.content, 'w')
  if (opts.screenshot) {
    page.render(PAGES_PATH + '/' + pageName + '.png')
  }
  console.log('done')
  phantom.exit()
}

var networkResources = {}
var networkCounter = 0
function rewaitNework(type, id, url) {
  switch (type) {
  case 'requested':
    networkCounter++
    networkResources[id] = url
    break
  case 'received':
    if (networkResources[id]) {
      delete networkResources[id]
      networkCounter--
    }
    break
  }
  if (!page_ready) {
    return
  }
  if (t_net) {
    clearTimeout(t_net)
  } else {
    console.log('detected network traffic')
  }
  t_net = setTimeout(onNetworkFinish, networkCounter <= 0 ? 1000 : 20000)
}

function onLoaded() {
  page_ready = true
  rewaitNework()
  console.log('scrolling down...')
  page.evaluate(function () {
    if (window.document.body.scrollTop >= document.body.scrollHeight - window.innerHeight) {
      return
    }
    // Scrolls to the bottom of page
    var _t = setInterval(function () {
      window.document.body.scrollTop += 100
      if (window.document.body.scrollTop >= document.body.scrollHeight - window.innerHeight) {
        clearTimeout(_t)
        localStorage.clear()
        if (typeof window.callPhantom === 'function') {
          window.callPhantom('SCROLL_DONE')
        }
      }
    }, 20)
  })
}

page.onResourceRequested = function (request) {
  rewaitNework('requested', request.id, request.url)
}
page.onResourceReceived = function (response) {
  if (response.stage === 'end') {
    rewaitNework('received', response.id)
  }
}

var t = null
page.open(pageUrl, function (status) {
  console.log('status: ' + status)
  if (t) {
    clearTimeout(t)
  }
  if (status === 'success') {
    onLoaded()
  } else {
    onError(status)
  }
})

t = setTimeout(function () {
  t = null
  onLoaded()
}, 10000)
