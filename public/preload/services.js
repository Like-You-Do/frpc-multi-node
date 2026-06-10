const fs = require('node:fs')
const path = require('node:path')
const { execSync, spawn } = require('node:child_process')

const frpcProcesses = new Map()

const isWin32 = process.platform === 'win32'
const isMacOS = process.platform === 'darwin'
const frpcBinName = isWin32 ? 'frpc.exe' : 'frpc'

function getUserDataPath () {
  return window.utools?.getPath ? window.utools.getPath('userData') : process.cwd()
}

function getFrpcBinDir () {
  return path.join(getUserDataPath(), 'frp-multi-node')
}

function getFrpcPath () {
  const frpcPath = path.join(getFrpcBinDir(), frpcBinName)

  if (fs.existsSync(frpcPath)) {
    return frpcPath
  }

  throw new Error('未找到 ' + frpcBinName)
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
    const basePath = getFrpcBinDir()
    if (!fs.existsSync(basePath)) {
      fs.mkdirSync(basePath, { recursive: true })
    }
    const filePath = path.join(basePath, fileName)
    fs.writeFileSync(filePath, content, { encoding: 'utf-8' })
    return filePath
  },
  deleteFrpcToml (fileName) {
    const filePath = path.join(getFrpcBinDir(), fileName)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    return filePath
  },
  cleanupOrphanedConfigs () {
    const basePath = getFrpcBinDir()
    if (!fs.existsSync(basePath)) return 0
    let count = 0
    try {
      const files = fs.readdirSync(basePath)
      files.forEach((file) => {
        if (file.startsWith('frpc_') && file.endsWith('.toml')) {
          try {
            fs.unlinkSync(path.join(basePath, file))
            count++
          } catch {}
        }
      })
    } catch {}
    return count
  },
  startFrpcTunnel (tunnelKey, content, fileName = 'frpc.toml') {
    const existingProcess = frpcProcesses.get(tunnelKey)

    if (existingProcess?.child && !existingProcess.child.killed && existingProcess.code === null) {
      return {
        pid: existingProcess.child.pid,
        running: true
      }
    }

    const basePath = getFrpcBinDir()
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
      windowsHide: isWin32,
      detached: !isWin32
    })

    processInfo.child = child
    frpcProcesses.set(tunnelKey, processInfo)

    child.stdout.on('data', (data) => pushFrpcLog(processInfo, data))
    child.stderr.on('data', (data) => pushFrpcLog(processInfo, data))
    child.on('error', (error) => pushFrpcLog(processInfo, `启动失败：${error.message}`))
    child.on('spawn', () => {
      const tryDelete = (retries) => {
        setTimeout(() => {
          try {
            fs.unlinkSync(configPath)
            pushFrpcLog(processInfo, `已清理配置文件：${configPath}`)
          } catch {
            if (retries > 0) tryDelete(retries - 1)
          }
        }, 1000)
      }
      tryDelete(3)
    })
    child.on('close', (code) => {
      processInfo.code = code
      pushFrpcLog(processInfo, `进程已退出，退出码：${code}`)
      try { fs.unlinkSync(configPath) } catch {}
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

    if (isWin32) {
      try {
        execSync(`taskkill /pid ${processInfo.child.pid} /T /F`, { windowsHide: true })
      } catch {
        processInfo.child.kill()
      }
    } else if (isMacOS) {
      // macOS: SIGTERM 后 3 秒未退出则 SIGKILL 强杀
      processInfo.child.kill('SIGTERM')
      setTimeout(() => {
        try { processInfo.child.kill('SIGKILL') } catch {}
      }, 3000)
    } else {
      // Linux: 通过进程组 ID 终止整棵进程树
      try {
        process.kill(-processInfo.child.pid, 'SIGTERM')
      } catch {
        processInfo.child.kill('SIGTERM')
      }
      setTimeout(() => {
        try { process.kill(-processInfo.child.pid, 'SIGKILL') } catch {}
        try { processInfo.child.kill('SIGKILL') } catch {}
      }, 3000)
    }

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
  clearFrpcTunnelLog (tunnelKey) {
    const processInfo = frpcProcesses.get(tunnelKey)

    if (!processInfo) return

    processInfo.logs.length = 0
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
    return getFrpcBinDir()
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
    const binDir = getFrpcBinDir()
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true })
    }
    const destPath = path.join(binDir, frpcBinName)
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
