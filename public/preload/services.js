const fs = require('node:fs')
const path = require('node:path')
const { execSync, spawn } = require('node:child_process')

const frpcProcesses = new Map()

const isWin32 = process.platform === 'win32'
const frpcBinName = isWin32 ? 'frpc.exe' : 'frpc'

function getUserDataPath () {
  return window.utools?.getPath ? window.utools.getPath('userData') : process.cwd()
}

function getFrpcPath () {
  const candidates = [
    path.join(__dirname, '..', frpcBinName),
    path.join(process.cwd(), frpcBinName),
    path.join(process.cwd(), 'public', frpcBinName),
    path.join(process.cwd(), 'dist', frpcBinName)
  ]

  const frpcPath = candidates.find((candidate) => fs.existsSync(candidate))

  if (!frpcPath) {
    throw new Error('未找到 ' + frpcBinName)
  }

  return frpcPath
}

function pushFrpcLog (processInfo, text) {
  const timestamp = new Date().toLocaleString()
  const lines = String(text)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => `[${timestamp}] ${line}`)

  processInfo.logs.push(...lines)

  if (processInfo.logs.length > 1000) {
    processInfo.logs.splice(0, processInfo.logs.length - 1000)
  }
}

window.services = {
  readFile (file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  writeTextFile (text) {
    const filePath = path.join(window.utools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  writeFrpcToml (content, fileName = 'frpc.toml') {
    const basePath = getUserDataPath()
    const filePath = path.join(basePath, fileName)
    fs.writeFileSync(filePath, content, { encoding: 'utf-8' })
    return filePath
  },
  deleteFrpcToml (fileName) {
    const filePath = path.join(getUserDataPath(), fileName)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    return filePath
  },
  startFrpcTunnel (tunnelKey, content, fileName = 'frpc.toml') {
    const existingProcess = frpcProcesses.get(tunnelKey)

    if (existingProcess?.child && !existingProcess.child.killed && existingProcess.code === null) {
      return {
        pid: existingProcess.child.pid,
        running: true
      }
    }

    const basePath = getUserDataPath()
    const configPath = path.join(basePath, fileName)
    const frpcPath = getFrpcPath()
    const processInfo = {
      child: null,
      code: null,
      logs: []
    }

    fs.writeFileSync(configPath, content, { encoding: 'utf-8' })
    pushFrpcLog(processInfo, `执行命令：${frpcPath} -c ${configPath}`)

    const child = spawn(frpcPath, ['-c', configPath], {
      cwd: basePath,
      windowsHide: isWin32
    })

    processInfo.child = child
    frpcProcesses.set(tunnelKey, processInfo)

    child.stdout.on('data', (data) => pushFrpcLog(processInfo, data))
    child.stderr.on('data', (data) => pushFrpcLog(processInfo, data))
    child.on('error', (error) => pushFrpcLog(processInfo, `启动失败：${error.message}`))
    child.on('close', (code) => {
      processInfo.code = code
      pushFrpcLog(processInfo, `进程已退出，退出码：${code}`)
    })

    return {
      pid: child.pid,
      running: true
    }
  },
  stopFrpcTunnel (tunnelKey) {
    const processInfo = frpcProcesses.get(tunnelKey)

    if (!processInfo?.child || processInfo.child.killed) {
      return {
        running: false
      }
    }

    processInfo.child.kill()
    pushFrpcLog(processInfo, '已请求停止进程')

    return {
      running: false
    }
  },
  getFrpcTunnelLog (tunnelKey) {
    const processInfo = frpcProcesses.get(tunnelKey)

    if (!processInfo) return ''

    return processInfo.logs.join('\n')
  },
  getFrpcTunnelStatus (tunnelKey) {
    const processInfo = frpcProcesses.get(tunnelKey)

    return Boolean(processInfo?.child && !processInfo.child.killed && processInfo.code === null)
  },
  writeImageFile (base64Url) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) return
    const filePath = path.join(window.utools.getPath('downloads'), Date.now().toString() + '.' + matchs[1])
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  },
  getConfigDir () {
    return getUserDataPath()
  },
  getFrpcExePath () {
    try {
      return getFrpcPath()
    } catch {
      return null
    }
  },
  checkFrpcAvailable () {
    try {
      const frpcPath = getFrpcPath()
      return fs.statSync(frpcPath).isFile()
    } catch {
      return false
    }
  },
  replaceFrpcExe (srcPath) {
    const destPath = path.join(__dirname, '..', frpcBinName)
    fs.copyFileSync(srcPath, destPath)
    if (!isWin32) {
      fs.chmodSync(destPath, 0o755)
    }
    return destPath
  },
  getFrpcVersion () {
    try {
      const frpcPath = getFrpcPath()
      const output = execSync(`"${frpcPath}" -v`, { encoding: 'utf-8', windowsHide: true }).trim()
      return output
    } catch (e) {
      return e.stderr?.trim() || e.message || null
    }
  }
}
