import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AppstoreOutlined,
  CloudServerOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
  SwapOutlined
} from '@ant-design/icons'
import {
  Button,
  ConfigProvider,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Layout,
  Menu,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message
} from 'antd'
import './app.css'

const { Header, Sider, Content } = Layout
const { Title, Text } = Typography

const menuItems = [
  { key: 'tunnel', icon: <AppstoreOutlined />, label: '隧道管理' },
  { key: 'server', icon: <CloudServerOutlined />, label: '服务端管理' },
  { key: 'environment', icon: <SettingOutlined />, label: '设置' }
]

const pageTitles = {
  tunnel: '隧道管理',
  server: '服务端管理',
  environment: '设置'
}

const initialServers = []
const initialTunnels = []

function loadPersistedState (key) {
  try {
    if (window.utools?.dbStorage) {
      return window.utools.dbStorage.getItem(key)
    }
  } catch {}
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {}
  return null
}

function persistState (key, value) {
  try {
    if (window.utools?.dbStorage) {
      window.utools.dbStorage.setItem(key, value)
      return
    }
  } catch {}
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

const ipRules = [
  { required: true, message: '请输入 IP 地址' },
  {
    validator (_, value) {
      if (!value) return Promise.resolve()
      const v = value.trim()
      const parts = v.split('.')
      if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) {
        return Promise.reject(new Error('请输入有效的 IPv4 地址，格式如 192.168.1.1'))
      }
      if (parts.every((p) => { const n = Number(p); return n >= 0 && n <= 255 })) {
        return Promise.resolve()
      }
      return Promise.reject(new Error('IP 地址每段范围为 0-255'))
    }
  }
]

const domainRules = [
  { required: true, message: '请输入域名' },
  {
    validator (_, value) {
      if (!value) return Promise.resolve()
      const v = value.trim()
      if (!v.includes('.')) {
        return Promise.reject(new Error('域名必须包含至少一个根域名'))
      }
      if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(v)) {
        const tld = v.split('.').pop()
        if (tld.length >= 2) return Promise.resolve()
        return Promise.reject(new Error('顶级域名至少 2 个字符'))
      }
      return Promise.reject(new Error('请输入有效的域名'))
    }
  }
]

const addressTypeOptions = [
  { label: 'IP', value: 'ip' },
  { label: '域名', value: 'domain' }
]

const portRules = [
  { required: true, message: '请输入端口' },
  { type: 'number', min: 1, max: 65535, message: '端口范围为 1-65535' }
]

const serverFormInitialValues = {
  name: '',
  ipType: 'ip',
  port: 7000,
  extraFields: [{ key: '', value: '' }]
}

const tunnelFormInitialValues = {
  type: 'tcp',
  bindAddrType: 'ip',
  bindAddr: '127.0.0.1',
  localIPType: 'ip',
  localIP: '127.0.0.1'
}

function isProxyTunnel (type) {
  return type === 'tcp' || type === 'udp'
}

function createId (prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function getServerConfigFile (serverId) {
  return `frpc_${serverId}.toml`
}

function normalizeExtraFields (extraFields = []) {
  return extraFields.reduce((extra, item) => {
    const key = item?.key?.trim()
    const value = item?.value

    if (key) {
      extra[key] = typeof value === 'string' ? value.trim() : value
    }

    return extra
  }, {})
}

function extraObjectToFields (extra = {}) {
  const fields = Object.entries(extra).map(([key, value]) => ({
    key,
    value: String(value)
  }))

  return fields.length ? fields : [{ key: '', value: '' }]
}

function formatTomlKey (key) {
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) return key
  return `"${escapeTomlString(key)}"`
}

function escapeTomlString (value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
}

function buildFrpcToml (server, tunnels = []) {
  const lines = server
    ? [
        `serverAddr = "${escapeTomlString(server.ip)}"`,
        `serverPort = ${server.port}`,
        '',
        'auth.method = "token"',
        `auth.token = "${escapeTomlString(server.token)}"`
      ]
    : [
        'serverAddr = ""',
        'serverPort = 7000',
        '',
        'auth.method = "token"',
        'auth.token = ""'
      ]

  const extraEntries = Object.entries(server?.extra || {})

  if (extraEntries.length) {
    lines.push('', '# 额外字段')
    extraEntries.forEach(([key, value]) => {
      lines.push(`${formatTomlKey(key)} = "${escapeTomlString(value)}"`)
    })
  }

  if (tunnels.length) {
    lines.push('', '# 隧道配置')
    tunnels.forEach((tunnel, index) => {
      if (index > 0) lines.push('')

      if (isProxyTunnel(tunnel.type)) {
        lines.push(
          '[[proxies]]',
          `name = "${escapeTomlString(tunnel.name)}"`,
          `type = "${escapeTomlString(tunnel.type)}"`,
          `localIP = "${escapeTomlString(tunnel.localIP)}"`,
          `localPort = ${tunnel.localPort}`,
          `remotePort = ${tunnel.remotePort}`
        )
        return
      }

      lines.push(
        '[[visitors]]',
        `name = "${escapeTomlString(tunnel.name)}"`,
        `type = "${escapeTomlString(tunnel.type)}"`,
        `serverName = "${escapeTomlString(tunnel.serviceName)}"`,
        `secretKey = "${escapeTomlString(tunnel.secretKey)}"`,
        `bindAddr = "${escapeTomlString(tunnel.bindAddr)}"`,
        `bindPort = ${tunnel.bindPort}`
      )
    })
  }

  lines.push('')
  return lines.join('\n')
}

function createServerFromValues (values, existingServer) {
  const id = existingServer?.id || createId('server')
  const ip = values.ip.trim()
  const token = values.token.trim()

  return {
    id,
    key: id,
    configFile: existingServer?.configFile || getServerConfigFile(id),
    name: values.name?.trim() || '',
    ipType: values.ipType || 'ip',
    ip,
    port: values.port,
    token,
    enabled: existingServer?.enabled !== false,
    extra: normalizeExtraFields(values.extraFields)
  }
}

function createTunnelFromValues (values, existingTunnel) {
  const id = existingTunnel?.id || createId('tunnel')
  const name = values.name.trim()
  const base = {
    id,
    key: id,
    serverId: values.serverId,
    type: values.type,
    name
  }

  if (isProxyTunnel(values.type)) {
    return {
      ...base,
      localIPType: values.localIPType || 'ip',
      localIP: values.localIP?.trim() || '127.0.0.1',
      localPort: values.localPort,
      remotePort: values.remotePort
    }
  }

  return {
    ...base,
    serviceName: values.serviceName.trim(),
    secretKey: values.secretKey.trim(),
    bindAddrType: values.bindAddrType || 'ip',
    bindAddr: values.bindAddr?.trim() || '127.0.0.1',
    bindPort: values.bindPort
  }
}

function ServerSettings ({
  messageApi,
  runningTunnels,
  servers,
  setRunningTunnels,
  setServers,
  setTunnels,
  tunnels
}) {
  const [form] = Form.useForm()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingServer, setEditingServer] = useState(null)
  const [searchText, setSearchText] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(5)
  const serverIpType = Form.useWatch('ipType', form) || serverFormInitialValues.ipType

  const filteredServers = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    const list = keyword
      ? servers.filter((s) =>
        (s.name || '').toLowerCase().includes(keyword) ||
        s.ip.toLowerCase().includes(keyword)
      )
      : servers
    return [...list].sort((a, b) => (b.enabled !== false) - (a.enabled !== false))
  }, [servers, searchText])

  const openCreateModal = () => {
    setEditingServer(null)
    form.resetFields()
    form.setFieldsValue(serverFormInitialValues)
    setIsModalOpen(true)
  }

  const openEditModal = (server) => {
    if (server.enabled !== false) {
      messageApi.warning('请关闭后再修改')
      return
    }
    setEditingServer(server)
    form.setFieldsValue({
      name: server.name,
      ipType: server.ipType || (/^\d/.test(server.ip) ? 'ip' : 'domain'),
      ip: server.ip,
      port: server.port,
      token: server.token,
      extraFields: extraObjectToFields(server.extra)
    })
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingServer(null)
  }

  const handleSaveServer = async () => {
    const values = await form.validateFields()
    const nextServer = createServerFromValues(values, editingServer)
    const nextServers = editingServer
      ? servers.map((server) => server.id === editingServer.id ? nextServer : server)
      : [...servers, nextServer]

    setServers(nextServers)
    closeModal()
  }

  const handleDeleteServer = (targetServer) => {
    if (targetServer.enabled !== false) {
      messageApi.warning('请关闭后再删除')
      return
    }
    const removedTunnels = tunnels.filter((tunnel) => tunnel.serverId === targetServer.id)
    const nextServers = servers.filter((server) => server.id !== targetServer.id)
    const nextTunnels = tunnels.filter((tunnel) => tunnel.serverId !== targetServer.id)

    removedTunnels.forEach((tunnel) => {
      window.services?.stopFrpcTunnel?.(tunnel.key)
    })
    setRunningTunnels((current) => {
      const nextRunningTunnels = { ...current }
      removedTunnels.forEach((tunnel) => {
        delete nextRunningTunnels[tunnel.key]
      })
      return nextRunningTunnels
    })
    setServers(nextServers)
    setTunnels(nextTunnels)
    messageApi.success('已删除服务端')
  }

  const handleToggleServer = (targetServer, enabled) => {
    const nextServers = servers.map((server) =>
      server.id === targetServer.id ? { ...server, enabled } : server
    )
    setServers(nextServers)

    if (!enabled) {
      const serverTunnels = tunnels.filter((tunnel) => tunnel.serverId === targetServer.id)
      serverTunnels.forEach((tunnel) => {
        window.services?.stopFrpcTunnel?.(tunnel.key)
      })
      setRunningTunnels((current) => {
        const next = { ...current }
        serverTunnels.forEach((tunnel) => {
          delete next[tunnel.key]
        })
        return next
      })
      messageApi.success('已禁用服务端并停止相关隧道')
    } else {
      messageApi.success('已启用服务端')
    }
  }

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (name) => name || <Text type='secondary'>未命名</Text>
    },
    {
      title: 'IP地址',
      dataIndex: 'ip',
      key: 'ip'
    },
    {
      title: '端口',
      dataIndex: 'port',
      key: 'port'
    },
    {
      title: 'Token',
      dataIndex: 'token',
      key: 'token',
      ellipsis: true,
      render: (token) => {
        if (!token) return ''
        if (token.length <= 2) return '*'.repeat(token.length)
        return token[0] + '*'.repeat(token.length - 2) + token[token.length - 1]
      }
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right',
      width: 160,
      render: (_, server) => (
        <Space size={6}>
          <Switch
            checked={server.enabled !== false}
            checkedChildren='启用'
            onChange={(checked) => handleToggleServer(server, checked)}
            unCheckedChildren='禁用'
          />
          <Tooltip title='修改'>
            <Button
              aria-label='修改服务端'
              className='icon-action-button'
              icon={<EditOutlined />}
              onClick={() => openEditModal(server)}
              type='text'
            />
          </Tooltip>
          <Popconfirm
            cancelText='取消'
            okText='删除'
            onConfirm={() => handleDeleteServer(server)}
            title='删除服务端会移除对应隧道，确定继续吗？'
          >
            <Tooltip title='删除'>
              <Button
                aria-label='删除服务端'
                className='icon-action-button'
                danger
                disabled={tunnels.some((tunnel) => tunnel.serverId === server.id && runningTunnels[tunnel.key])}
                icon={<DeleteOutlined />}
                type='text'
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div className='page-stack'>
      <div className='toolbar-actions'>
        <Input
          allowClear
          className='search-input'
          placeholder='搜索名称、IP地址…'
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => { setSearchText(e.target.value); setCurrentPage(1) }}
        />
        <Button type='primary' icon={<CloudServerOutlined />} onClick={openCreateModal}>新增服务端</Button>
      </div>
      <Table
        bordered
        columns={columns}
        dataSource={filteredServers.slice((currentPage - 1) * pageSize, currentPage * pageSize)}
        pagination={false}
        scroll={{ x: 'max-content' }}
        size='small'
        title={() => (
          <div className='table-top-panel'>
            <Pagination
              current={currentPage}
              onChange={(page, size) => {
                if (size !== pageSize) { setPageSize(size); setCurrentPage(1) } else setCurrentPage(page)
              }}
              pageSize={pageSize}
              pageSizeOptions={[5, 10, 20, 50]}
              showSizeChanger
              showTotal={(total) => `共 ${total} 条`}
              size='small'
              total={filteredServers.length}
            />
          </div>
        )}
      />
      <Drawer
        destroyOnClose
        extra={
          <Space>
            <Button onClick={closeModal}>取消</Button>
            <Button type='primary' onClick={handleSaveServer}>保存</Button>
          </Space>
        }
        onClose={closeModal}
        open={isModalOpen}
        title={editingServer ? '修改服务端' : '新增服务端'}
        width={480}
      >
        <Form className='server-form' form={form} initialValues={serverFormInitialValues} layout='vertical'>
          <Form.Item label='名称' name='name'>
            <Input placeholder='例如 生产环境' />
          </Form.Item>
          <div className='address-row'>
            <Form.Item label='类型' name='ipType' rules={[{ required: true, message: '请选择类型' }]}>
              <Select className='address-type-select' options={addressTypeOptions} onChange={() => form.setFieldValue('ip', undefined)} />
            </Form.Item>
            <Form.Item
              className='address-input-item'
              label='地址'
              name='ip'
              rules={serverIpType === 'domain' ? domainRules : ipRules}
            >
              <Input placeholder={serverIpType === 'domain' ? '例如 frp.example.com' : '例如 120.26.18.91'} />
            </Form.Item>
            <Form.Item
              label='端口'
              name='port'
              rules={portRules}
            >
              <InputNumber className='port-input' controls={false} placeholder='7000' />
            </Form.Item>
          </div>
          <Form.Item label='Token' name='token' rules={[{ required: true, message: '请输入 token' }]}>
            <Input.Password autoComplete='new-password' placeholder='请输入服务端 token' />
          </Form.Item>
          <Form.List name='extraFields'>
            {(fields, { add, remove }) => (
              <div className='extra-fields'>
                <div className='field-section-title'>
                  <Text strong>额外字段</Text>
                  <Button icon={<PlusOutlined />} onClick={() => add({ key: '', value: '' })} type='link'>添加字段</Button>
                </div>
                {fields.map((field) => {
                  const { key, ...fieldProps } = field

                  return (
                    <div className='extra-field-row' key={key}>
                      <Form.Item
                        {...fieldProps}
                        className='extra-field-item'
                        name={[field.name, 'key']}
                        rules={[
                          ({ getFieldValue }) => ({
                            validator (_, value) {
                              const extraKey = value?.trim()
                              const extraFields = getFieldValue('extraFields') || []
                              const duplicateCount = extraFields.filter((item) => item?.key?.trim() === extraKey).length

                              if (!extraKey || duplicateCount <= 1) return Promise.resolve()
                              return Promise.reject(new Error('字段名不能重复'))
                            }
                          })
                        ]}
                      >
                        <Input placeholder='字段名' />
                      </Form.Item>
                      <Form.Item {...fieldProps} className='extra-field-item' name={[field.name, 'value']}>
                        <Input placeholder='字段值' />
                      </Form.Item>
                      <Button
                        aria-label='删除字段'
                        className='delete-field-button'
                        icon={<DeleteOutlined />}
                        onClick={() => remove(field.name)}
                        type='text'
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </Form.List>
        </Form>
      </Drawer>
    </div>
  )
}

function TunnelSettings ({
  messageApi,
  runningTunnels,
  servers,
  setRunningTunnels,
  setTunnels,
  tunnels
}) {
  const [form] = Form.useForm()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTunnel, setEditingTunnel] = useState(null)
  const [logModal, setLogModal] = useState({ content: '', open: false, title: '' })
  const [searchText, setSearchText] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(5)
  const [selectedServerId, setSelectedServerId] = useState(null)
  const selectedType = Form.useWatch('type', form) || tunnelFormInitialValues.type
  const isProxyForm = isProxyTunnel(selectedType)
  const localIPType = Form.useWatch('localIPType', form) || tunnelFormInitialValues.localIPType
  const bindAddrType = Form.useWatch('bindAddrType', form) || tunnelFormInitialValues.bindAddrType
  const serverOptions = servers.map((server) => ({
    label: `${server.name} (${server.ip}:${server.port})`,
    value: server.id
  }))

  const getServerById = (serverId) => servers.find((server) => server.id === serverId)

  const filteredTunnels = useMemo(() => {
    const enabledServerIds = new Set(servers.filter((s) => s.enabled !== false).map((s) => s.id))
    const keyword = searchText.trim().toLowerCase()
    const list = tunnels.filter((t) => {
      if (!enabledServerIds.has(t.serverId)) return false
      if (!keyword) return true
      return t.name.toLowerCase().includes(keyword) ||
        t.type.toLowerCase().includes(keyword)
    })
    return [...list].sort((a, b) => Boolean(runningTunnels[b.key]) - Boolean(runningTunnels[a.key]))
  }, [tunnels, searchText, runningTunnels, servers])

  const enabledServers = useMemo(() => servers.filter((s) => s.enabled !== false), [servers])

  const filteredTunnelsByServer = useMemo(() => {
    if (!selectedServerId) return filteredTunnels
    return filteredTunnels.filter((t) => t.serverId === selectedServerId)
  }, [filteredTunnels, selectedServerId])

  const openCreateModal = () => {
    setEditingTunnel(null)
    form.resetFields()
    form.setFieldsValue({
      ...tunnelFormInitialValues,
      serverId: selectedServerId || servers[0]?.id
    })
    setIsModalOpen(true)
  }

  const openEditModal = (tunnel) => {
    if (runningTunnels[tunnel.key]) {
      messageApi.warning('请关闭后再修改')
      return
    }
    setEditingTunnel(tunnel)
    form.setFieldsValue({
      ...tunnel,
      localIPType: tunnel.localIPType || (/^\d/.test(tunnel.localIP) ? 'ip' : 'domain'),
      bindAddrType: tunnel.bindAddrType || (/^\d/.test(tunnel.bindAddr) ? 'ip' : 'domain')
    })
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingTunnel(null)
  }

  const handleFormValuesChange = (changedValues) => {
    if (!changedValues.type) return

    if (isProxyTunnel(changedValues.type)) {
      form.setFieldsValue({ localIP: form.getFieldValue('localIP') || '127.0.0.1' })
      return
    }

    form.setFieldsValue({ bindAddr: form.getFieldValue('bindAddr') || '127.0.0.1' })
  }

  const handleSaveTunnel = async () => {
    const values = await form.validateFields()
    const nextTunnel = createTunnelFromValues(values, editingTunnel)
    const nextTunnels = editingTunnel
      ? tunnels.map((tunnel) => tunnel.id === editingTunnel.id ? nextTunnel : tunnel)
      : [...tunnels, nextTunnel]

    setTunnels(nextTunnels)
    closeModal()
  }

  const handleDeleteTunnel = (targetTunnel) => {
    if (runningTunnels[targetTunnel.key]) {
      messageApi.warning('请关闭后再删除')
      return
    }
    const nextTunnels = tunnels.filter((tunnel) => tunnel.id !== targetTunnel.id)

    window.services?.stopFrpcTunnel?.(targetTunnel.key)
    setRunningTunnels((current) => {
      const nextRunningTunnels = { ...current }
      delete nextRunningTunnels[targetTunnel.key]
      return nextRunningTunnels
    })
    setTunnels(nextTunnels)
  }

  const handleToggleTunnel = (tunnel, checked) => {
    const startTunnel = window.services?.startFrpcTunnel
    const stopTunnel = window.services?.stopFrpcTunnel
    const server = getServerById(tunnel.serverId)

    if (!server) {
      messageApi.warning('请先选择有效服务端')
      return
    }

    if (checked && server.enabled === false) {
      messageApi.warning('服务端已禁用，请先启用服务端')
      return
    }

    if (checked && !startTunnel) {
      messageApi.warning('当前浏览器环境无法启动 frpc 二进制文件，请在 uTools 插件环境中使用')
      return
    }

    try {
      if (checked) {
        const content = buildFrpcToml(server, [tunnel])
        startTunnel(tunnel.key, content, `frpc_${tunnel.id}.toml`)
        setRunningTunnels((current) => ({ ...current, [tunnel.key]: true }))
        messageApi.success('隧道已启动')
        return
      }

      stopTunnel?.(tunnel.key)
      setRunningTunnels((current) => ({ ...current, [tunnel.key]: false }))
      messageApi.success('隧道已停止')
    } catch (error) {
      setRunningTunnels((current) => ({ ...current, [tunnel.key]: false }))
      messageApi.error(`隧道操作失败：${error.message}`)
    }
  }

  const openLogModal = (tunnel) => {
    const content = window.services?.getFrpcTunnelLog?.(tunnel.key) || '暂无日志'
    setLogModal({ content, open: true, title: `${tunnel.name} 日志`, tunnelKey: tunnel.key })
  }

  const closeLogModal = () => {
    setLogModal((current) => ({ ...current, open: false }))
  }

  const clearLog = () => {
    if (!logModal.tunnelKey) return
    window.services?.clearFrpcTunnelLog?.(logModal.tunnelKey)
    setLogModal((current) => ({ ...current, content: '' }))
  }

  const columns = [
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 50,
      render: (type) => <Tag>{type}</Tag>
    },
    { title: '名称', dataIndex: 'name', key: 'name' },
    {
      title: '操作',
      key: 'action',
      fixed: 'right',
      width: 190,
      render: (_, tunnel) => (
        <Space size={6}>
          <Switch
            checked={Boolean(runningTunnels[tunnel.key])}
            checkedChildren='开'
            onChange={(checked) => handleToggleTunnel(tunnel, checked)}
            unCheckedChildren='关'
          />
          <Tooltip title='修改'>
            <Button
              aria-label='修改隧道'
              className='icon-action-button'
              icon={<EditOutlined />}
              onClick={() => openEditModal(tunnel)}
              type='text'
            />
          </Tooltip>
          <Tooltip title='日志'>
            <Button
              aria-label='查看日志'
              className='icon-action-button'
              icon={<FileTextOutlined />}
              onClick={() => openLogModal(tunnel)}
              type='text'
            />
          </Tooltip>
          <Popconfirm
            cancelText='取消'
            okText='删除'
            onConfirm={() => handleDeleteTunnel(tunnel)}
            title='确定删除该隧道吗？'
          >
            <Tooltip title='删除'>
              <Button
                aria-label='删除隧道'
                className='icon-action-button'
                danger
                icon={<DeleteOutlined />}
                type='text'
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div className='tunnel-split-panel'>
      <div className='tunnel-server-filter'>
        <div className='server-filter-title'>服务端</div>
        <Menu
          items={[
            { key: 'all', label: `全部 (${tunnels.length})` },
            ...enabledServers.map((s) => ({
              key: s.id,
              label: `${s.name} (${tunnels.filter((t) => t.serverId === s.id).length})`
            }))
          ]}
          mode='inline'
          onClick={({ key }) => { setSelectedServerId(key === 'all' ? null : key); setCurrentPage(1) }}
          selectedKeys={[selectedServerId || 'all']}
        />
      </div>
      <div className='tunnel-main-content'>
        <div className='page-stack'>
          <div className='toolbar-actions'>
            <Input
              allowClear
              className='search-input'
              placeholder='搜索名称、类型…'
              prefix={<SearchOutlined />}
              value={searchText}
              onChange={(e) => { setSearchText(e.target.value); setCurrentPage(1) }}
            />
            <Button disabled={!servers.length} type='primary' icon={<PlusOutlined />} onClick={openCreateModal}>新增隧道</Button>
          </div>
          <Table
            bordered
            columns={columns}
            dataSource={filteredTunnelsByServer.slice((currentPage - 1) * pageSize, currentPage * pageSize)}
            pagination={false}
            scroll={{ x: 'max-content' }}
            size='small'
            title={() => (
              <div className='table-top-panel'>
                <Pagination
                  current={currentPage}
                  onChange={(page, size) => {
                    if (size !== pageSize) { setPageSize(size); setCurrentPage(1) } else setCurrentPage(page)
                  }}
                  pageSize={pageSize}
                  pageSizeOptions={[5, 10, 20, 50]}
                  showSizeChanger
                  showTotal={(total) => `共 ${total} 条`}
                  size='small'
                  total={filteredTunnelsByServer.length}
                />
              </div>
            )}
          />
          <Drawer
            destroyOnClose
            extra={
              <Space>
                <Button onClick={closeModal}>取消</Button>
                <Button type='primary' onClick={handleSaveTunnel}>保存</Button>
              </Space>
            }
            onClose={closeModal}
            open={isModalOpen}
            title={editingTunnel ? '修改隧道' : '新增隧道'}
            width={520}
          >
            <Form
              className='server-form'
              form={form}
              initialValues={tunnelFormInitialValues}
              layout='vertical'
              onValuesChange={handleFormValuesChange}
            >
              <Form.Item label='服务端' name='serverId' rules={[{ required: true, message: '请选择服务端' }]}>
                <Select optionFilterProp='label' options={serverOptions} placeholder='请选择服务端' showSearch />
              </Form.Item>
              <div className='tunnel-form-grid'>
                <Form.Item label='类型' name='type' rules={[{ required: true, message: '请选择类型' }]}>
                  <Select
                    options={[
                      { label: 'tcp', value: 'tcp' },
                      { label: 'udp', value: 'udp' },
                      { label: 'stcp', value: 'stcp' },
                      { label: 'xtcp', value: 'xtcp' }
                    ]}
                  />
                </Form.Item>
                <Form.Item label='名称' name='name' rules={[{ required: true, message: '请输入名称' }]}>
                  <Input placeholder={isProxyForm ? '例如 ssh' : '例如 xxx_visitor'} />
                </Form.Item>
              </div>
              {isProxyForm
                ? (
                  <>
                    <div className='address-row'>
                      <Form.Item label='类型' name='localIPType' rules={[{ required: true, message: '请选择类型' }]}>
                        <Select className='address-type-select' options={addressTypeOptions} onChange={() => form.setFieldValue('localIP', undefined)} />
                      </Form.Item>
                      <Form.Item
                        className='address-input-item'
                        label='本地地址'
                        name='localIP'
                        rules={localIPType === 'domain' ? domainRules : ipRules}
                      >
                        <Input placeholder={localIPType === 'domain' ? '例如 frp.example.com' : '例如 127.0.0.1'} />
                      </Form.Item>
                      <Form.Item
                        label='本地端口'
                        name='localPort'
                        rules={portRules}
                      >
                        <InputNumber className='port-input' controls={false} placeholder='22' />
                      </Form.Item>
                    </div>
                    <Form.Item
                      label='远程端口'
                      name='remotePort'
                      rules={portRules}
                    >
                      <InputNumber className='full-width' controls={false} placeholder='6000' />
                    </Form.Item>
                  </>
                  )
                : (
                  <>
                    <div className='tunnel-form-grid'>
                      <Form.Item label='服务名' name='serviceName' rules={[{ required: true, message: '请输入服务名' }]}>
                        <Input placeholder='例如 xxx' />
                      </Form.Item>
                      <Form.Item label='秘钥' name='secretKey' rules={[{ required: true, message: '请输入秘钥' }]}>
                        <Input.Password autoComplete='new-password' placeholder='请输入 secretKey' />
                      </Form.Item>
                    </div>
                    <div className='address-row'>
                      <Form.Item label='类型' name='bindAddrType' rules={[{ required: true, message: '请选择类型' }]}>
                        <Select className='address-type-select' options={addressTypeOptions} onChange={() => form.setFieldValue('bindAddr', undefined)} />
                      </Form.Item>
                      <Form.Item
                        className='address-input-item'
                        label='绑定地址'
                        name='bindAddr'
                        rules={bindAddrType === 'domain' ? domainRules : ipRules}
                      >
                        <Input placeholder={bindAddrType === 'domain' ? '例如 frp.example.com' : '例如 127.0.0.1'} />
                      </Form.Item>
                      <Form.Item
                        label='绑定端口'
                        name='bindPort'
                        rules={portRules}
                      >
                        <InputNumber className='port-input' controls={false} placeholder='3000' />
                      </Form.Item>
                    </div>
                  </>
                  )}
            </Form>
          </Drawer>
          <Drawer extra={<Space><Button disabled={!logModal.tunnelKey} onClick={clearLog}>清空日志</Button><Button onClick={closeLogModal}>关闭</Button></Space>} onClose={closeLogModal} open={logModal.open} title={logModal.title} width={560}>
            <pre className='log-content'>{logModal.content}</pre>
          </Drawer>
        </div>
      </div>
    </div>
  )
}

function EnvironmentSettings ({ messageApi }) {
  const [configDir, setConfigDir] = useState(null)
  const [frpcPath, setFrpcPath] = useState(null)
  const [frpcVersion, setFrpcVersion] = useState(null)
  const [frpcAvailable, setFrpcAvailable] = useState(null)
  const isServicesAvailable = !!window.services

  const loadInfo = useCallback(() => {
    if (!isServicesAvailable) return
    try { setConfigDir(window.services.getConfigDir()) } catch {}
    try { setFrpcPath(window.services.getFrpcExePath()) } catch {}
    try { setFrpcAvailable(window.services.checkFrpcAvailable()) } catch {}
    try { setFrpcVersion(window.services.getFrpcVersion()) } catch {}
  }, [isServicesAvailable])

  useEffect(() => { loadInfo() }, [loadInfo])

  const handleReplaceFrpc = async () => {
    if (!isServicesAvailable) {
      messageApi.warning('浏览器环境下无法替换二进制文件')
      return
    }
    try {
      const dialogOptions = {
        properties: ['openFile']
      }
      const platform = navigator.platform || ''
      if (platform.includes('Win')) {
        dialogOptions.filters = [{ name: '可执行文件', extensions: ['exe'] }]
      } else if (platform.includes('Mac')) {
        dialogOptions.filters = [{ name: 'Unix可执行文件', extensions: [''] }]
      }
      const result = await window.utools.showOpenDialog(dialogOptions)
      if (!result || !result.length) return
      window.services.replaceFrpcExe(result[0])
      messageApi.success('替换成功')
      loadInfo()
    } catch (e) {
      messageApi.error('替换失败：' + e.message)
    }
  }

  return (
    <div className='page-stack'>
      <Title level={3}>设置</Title>
      <Descriptions bordered column={1} size='middle'>
        <Descriptions.Item label='配置文件目录'>
          {isServicesAvailable
            ? <Text copyable>{configDir ?? '加载中...'}</Text>
            : <Text type='secondary'>localStorage (浏览器模式)</Text>}
        </Descriptions.Item>
        <Descriptions.Item label='frpc 二进制文件 路径'>
          {isServicesAvailable
            ? (frpcPath
                ? <Text copyable>{frpcPath}</Text>
                : (
                  <>
                    <Text type='danger'>未找到</Text>
                    <div style={{ marginTop: 8 }}>
                      <Button
                        icon={<DownloadOutlined />}
                        onClick={() => {
                          const url = 'https://github.com/fatedier/frp/releases'
                          navigator.clipboard.writeText(url)
                          messageApi.success('已复制下载链接')
                        }}
                        type='link'
                      >
                        从 GitHub 下载 frp
                      </Button>
                    </div>
                  </>
                  ))
            : <Text type='secondary'>浏览器环境不可用</Text>}
        </Descriptions.Item>
        <Descriptions.Item label='frpc 版本'>
          {isServicesAvailable
            ? (frpcVersion
                ? <Tag color='blue'>{frpcVersion}</Tag>
                : <Text type='secondary'>无法获取</Text>)
            : <Text type='secondary'>浏览器环境不可用</Text>}
        </Descriptions.Item>
        <Descriptions.Item label='二进制可用性'>
          {isServicesAvailable
            ? (frpcAvailable
                ? <Tag color='success'>可用</Tag>
                : <Tag color='error'>不可用</Tag>)
            : <Tag color='warning'>浏览器环境</Tag>}
        </Descriptions.Item>
        <Descriptions.Item label='替换运行文件'>
          <Button
            disabled={!isServicesAvailable}
            icon={<SwapOutlined />}
            onClick={handleReplaceFrpc}
          >
            选择文件替换 frpc 二进制文件
          </Button>
        </Descriptions.Item>
      </Descriptions>
    </div>
  )
}

function renderPage (route, props) {
  if (route === 'server') return <ServerSettings {...props} />
  if (route === 'environment') return <EnvironmentSettings messageApi={props.messageApi} />
  return <TunnelSettings {...props} />
}

export default function App () {
  const [messageApi, contextHolder] = message.useMessage()
  const [collapsed, setCollapsed] = useState(true)
  const [route, setRoute] = useState('tunnel')
  const [servers, setServers] = useState(() => loadPersistedState('frpc_servers') || initialServers)
  const [tunnels, setTunnels] = useState(() => loadPersistedState('frpc_tunnels') || initialTunnels)
  const [runningTunnels, setRunningTunnels] = useState({})

  useEffect(() => { persistState('frpc_servers', servers) }, [servers])
  useEffect(() => { persistState('frpc_tunnels', tunnels) }, [tunnels])

  useEffect(() => {
    try { window.services?.cleanupOrphanedConfigs?.() } catch {}
    try {
      const result = window.services?.restoreRunningTunnels?.()
      if (result) setRunningTunnels(result)
    } catch {}
  }, [])

  useEffect(() => {
    if (!window.utools?.onPluginEnter) return

    window.utools.onPluginEnter((action) => {
      if (pageTitles[action.code]) setRoute(action.code)
      try {
        const result = window.services?.restoreRunningTunnels?.()
        if (result) setRunningTunnels(result)
      } catch {}
    })

    window.utools.onPluginOut((isKill) => {
      if (isKill) {
        try { window.services?.stopAllTunnels?.() } catch { }
      } else {
        try { window.services?.cleanupOrphanedConfigs?.() } catch { }
      }
    })
  }, [])

  return (
    <ConfigProvider
      theme={{
        token: {
          borderRadius: 6,
          colorBgBase: '#ffffff',
          colorPrimary: '#f97316',
          colorPrimaryHover: '#fb923c'
        },
        components: {
          Layout: { bodyBg: '#ffffff', headerBg: '#ffffff', siderBg: '#ffffff' },
          Menu: {
            darkItemBg: '#ffffff',
            darkItemColor: '#7c2d12',
            darkItemHoverBg: '#fff7ed',
            darkItemHoverColor: '#ea580c',
            darkItemSelectedBg: '#ffedd5',
            darkItemSelectedColor: '#c2410c'
          }
        }
      }}
    >
      {contextHolder}
      <Layout className='app-layout'>
        <Sider collapsed={collapsed} collapsedWidth={72} trigger={null} width={160}>
          <div className='brand'>
            <CloudServerOutlined />
            {!collapsed && <span>FRP 多节点</span>}
          </div>
          <Menu className='side-menu' items={menuItems} mode='inline' onClick={({ key }) => setRoute(key)} selectedKeys={[route]} theme='dark' />
        </Sider>
        <Layout>
          <Header className='app-header'>
            <Button
              aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
              type='text'
            />
            <Title level={4}>{pageTitles[route]}</Title>
          </Header>
          <Content className='app-content'>
            {renderPage(route, {
              messageApi,
              runningTunnels,
              servers,
              setRunningTunnels,
              setServers,
              setTunnels,
              tunnels
            })}
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  )
}
