import { useEffect, useState } from 'react'
import {
  AppstoreOutlined,
  CloudServerOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  SettingOutlined
} from '@ant-design/icons'
import {
  Button,
  ConfigProvider,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Layout,
  Menu,
  Modal,
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
  { key: 'tunnel', icon: <AppstoreOutlined />, label: '隧道设置' },
  { key: 'server', icon: <CloudServerOutlined />, label: '服务器设置' },
  { key: 'environment', icon: <SettingOutlined />, label: '环境设置' }
]

const pageTitles = {
  tunnel: '隧道设置',
  server: '服务器设置',
  environment: '环境设置'
}

const initialServers = []
const initialTunnels = []

const serverFormInitialValues = {
  port: 7000,
  extraFields: [{ key: '', value: '' }]
}

const tunnelFormInitialValues = {
  type: 'stcp',
  bindAddr: '127.0.0.1',
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

function writeServerFrpcToml (server, allTunnels) {
  const serverTunnels = allTunnels.filter((tunnel) => tunnel.serverId === server.id)
  const content = buildFrpcToml(server, serverTunnels)
  const writeFile = window.services?.writeFrpcToml

  if (writeFile) {
    return writeFile(content, server.configFile)
  }

  window.localStorage.setItem(server.configFile, content)
  return `localStorage:${server.configFile}`
}

function deleteServerFrpcToml (server) {
  const deleteFile = window.services?.deleteFrpcToml

  if (deleteFile) return deleteFile(server.configFile)

  window.localStorage.removeItem(server.configFile)
  return `localStorage:${server.configFile}`
}

function createServerFromValues (values, existingServer) {
  const id = existingServer?.id || createId('server')
  const ip = values.ip.trim()
  const token = values.token.trim()

  return {
    id,
    key: id,
    configFile: existingServer?.configFile || getServerConfigFile(id),
    ip,
    port: values.port,
    token,
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
      localIP: values.localIP?.trim() || '127.0.0.1',
      localPort: values.localPort,
      remotePort: values.remotePort
    }
  }

  return {
    ...base,
    serviceName: values.serviceName.trim(),
    secretKey: values.secretKey.trim(),
    bindAddr: values.bindAddr?.trim() || '127.0.0.1',
    bindPort: values.bindPort
  }
}

function ServerSettings ({
  configPath,
  messageApi,
  persistServerConfig,
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

  const openCreateModal = () => {
    setEditingServer(null)
    form.resetFields()
    form.setFieldsValue(serverFormInitialValues)
    setIsModalOpen(true)
  }

  const openEditModal = (server) => {
    setEditingServer(server)
    form.setFieldsValue({
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
    persistServerConfig(nextServer, tunnels)
    closeModal()
  }

  const handleDeleteServer = (targetServer) => {
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
    deleteServerFrpcToml(targetServer)
    messageApi.success(`已删除 ${targetServer.configFile}`)
  }

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      ellipsis: true,
      width: 190
    },
    {
      title: '配置文件',
      dataIndex: 'configFile',
      key: 'configFile',
      width: 220
    },
    {
      title: 'IP地址',
      dataIndex: 'ip',
      key: 'ip',
      width: 180
    },
    {
      title: '端口',
      dataIndex: 'port',
      key: 'port',
      width: 120
    },
    {
      title: 'Token',
      dataIndex: 'token',
      key: 'token',
      ellipsis: true
    },
    {
      title: '额外字段',
      dataIndex: 'extra',
      key: 'extra',
      render: (extra = {}) => {
        const entries = Object.entries(extra)

        if (!entries.length) return <Text type='secondary'>无</Text>

        return (
          <Space size={[6, 6]} wrap>
            {entries.map(([key, value]) => (
              <Tag className='kv-tag' key={key}>
                <span className='kv-key'>{key}</span>
                <span className='kv-value'>{String(value)}</span>
              </Tag>
            ))}
          </Space>
        )
      }
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right',
      width: 96,
      render: (_, server) => (
        <Space size={4}>
          <Tooltip title='修改'>
            <Button
              aria-label='修改服务器'
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
            title='删除服务器会移除对应隧道和配置文件，确定继续吗？'
          >
            <Tooltip title='删除'>
              <Button
                aria-label='删除服务器'
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
      <div className='page-toolbar'>
        <div>
          <Title level={3}>服务器设置</Title>
          <Text type='secondary'>每条服务器记录独立维护一个 frpc_id.toml。</Text>
          {configPath && <div className='config-path'>最近配置：{configPath}</div>}
        </div>
        <Button type='primary' icon={<CloudServerOutlined />} onClick={openCreateModal}>新增服务器</Button>
      </div>
      <Table
        bordered
        columns={columns}
        dataSource={servers}
        pagination={false}
        scroll={{ x: 1240 }}
      />
      <Modal
        destroyOnHidden
        forceRender
        okText='保存'
        onCancel={closeModal}
        onOk={handleSaveServer}
        open={isModalOpen}
        title={editingServer ? '修改服务器' : '新增服务器'}
        width={680}
      >
        <Form className='server-form' form={form} initialValues={serverFormInitialValues} layout='vertical'>
          <div className='form-grid'>
            <Form.Item
              label='IP地址'
              name='ip'
              rules={[
                { required: true, message: '请输入 IP 地址' },
                {
                  pattern: /^(\d{1,3}\.){3}\d{1,3}$|^[a-zA-Z0-9.-]+$/,
                  message: '请输入有效的 IP 地址或域名'
                }
              ]}
            >
              <Input placeholder='例如 120.26.18.91' />
            </Form.Item>
            <Form.Item
              label='端口'
              name='port'
              rules={[
                { required: true, message: '请输入端口' },
                { type: 'number', min: 1, max: 65535, message: '端口范围为 1-65535' }
              ]}
            >
              <InputNumber className='full-width' controls={false} placeholder='7000' />
            </Form.Item>
          </div>
          <Form.Item label='Token' name='token' rules={[{ required: true, message: '请输入 token' }]}>
            <Input.Password autoComplete='new-password' placeholder='请输入服务器 token' />
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
      </Modal>
    </div>
  )
}

function TunnelSettings ({
  configPath,
  messageApi,
  persistServerConfig,
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
  const selectedType = Form.useWatch('type', form) || tunnelFormInitialValues.type
  const isProxyForm = isProxyTunnel(selectedType)
  const serverOptions = servers.map((server) => ({
    label: `${server.ip}:${server.port} (${server.configFile})`,
    value: server.id
  }))

  const getServerById = (serverId) => servers.find((server) => server.id === serverId)

  const openCreateModal = () => {
    setEditingTunnel(null)
    form.resetFields()
    form.setFieldsValue({
      ...tunnelFormInitialValues,
      serverId: servers[0]?.id
    })
    setIsModalOpen(true)
  }

  const openEditModal = (tunnel) => {
    setEditingTunnel(tunnel)
    form.setFieldsValue(tunnel)
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
    const nextServer = getServerById(nextTunnel.serverId)
    const previousServer = editingTunnel && editingTunnel.serverId !== nextTunnel.serverId
      ? getServerById(editingTunnel.serverId)
      : null

    setTunnels(nextTunnels)
    if (nextServer) persistServerConfig(nextServer, nextTunnels)
    if (previousServer) persistServerConfig(previousServer, nextTunnels)
    closeModal()
  }

  const handleDeleteTunnel = (targetTunnel) => {
    const nextTunnels = tunnels.filter((tunnel) => tunnel.id !== targetTunnel.id)
    const server = getServerById(targetTunnel.serverId)

    window.services?.stopFrpcTunnel?.(targetTunnel.key)
    setRunningTunnels((current) => {
      const nextRunningTunnels = { ...current }
      delete nextRunningTunnels[targetTunnel.key]
      return nextRunningTunnels
    })
    setTunnels(nextTunnels)
    if (server) persistServerConfig(server, nextTunnels)
  }

  const handleToggleTunnel = (tunnel, checked) => {
    const startTunnel = window.services?.startFrpcTunnel
    const stopTunnel = window.services?.stopFrpcTunnel
    const server = getServerById(tunnel.serverId)

    if (!server) {
      messageApi.warning('请先选择有效服务器')
      return
    }

    if (checked && !startTunnel) {
      messageApi.warning('当前浏览器环境无法启动 frpc.exe，请在 uTools 插件环境中使用')
      return
    }

    try {
      if (checked) {
        const serverTunnels = tunnels.filter((item) => item.serverId === server.id)
        const content = buildFrpcToml(server, serverTunnels)
        startTunnel(tunnel.key, content, server.configFile)
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
    setLogModal({ content, open: true, title: `${tunnel.name} 日志` })
  }

  const closeLogModal = () => {
    setLogModal((current) => ({ ...current, open: false }))
  }

  const columns = [
    {
      title: '服务器',
      dataIndex: 'serverId',
      key: 'serverId',
      width: 220,
      render: (serverId) => {
        const server = getServerById(serverId)
        return server ? `${server.ip}:${server.port}` : <Text type='secondary'>未绑定</Text>
      }
    },
    {
      title: '服务名',
      dataIndex: 'serviceName',
      key: 'serviceName',
      width: 170,
      render: (serviceName, tunnel) => isProxyTunnel(tunnel.type) ? <Text type='secondary'>无</Text> : serviceName
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 110,
      render: (type) => <Tag>{type}</Tag>
    },
    {
      title: '秘钥',
      dataIndex: 'secretKey',
      key: 'secretKey',
      ellipsis: true,
      width: 160,
      render: (secretKey, tunnel) => isProxyTunnel(tunnel.type) ? <Text type='secondary'>无</Text> : secretKey
    },
    { title: '名称', dataIndex: 'name', key: 'name', width: 180 },
    {
      title: '绑定地址',
      dataIndex: 'bindAddr',
      key: 'bindAddr',
      width: 160,
      render: (bindAddr, tunnel) => isProxyTunnel(tunnel.type) ? <Text type='secondary'>无</Text> : bindAddr
    },
    {
      title: '绑定端口',
      dataIndex: 'bindPort',
      key: 'bindPort',
      width: 120,
      render: (bindPort, tunnel) => isProxyTunnel(tunnel.type) ? <Text type='secondary'>无</Text> : bindPort
    },
    {
      title: '本地IP',
      dataIndex: 'localIP',
      key: 'localIP',
      width: 160,
      render: (localIP, tunnel) => isProxyTunnel(tunnel.type) ? localIP : <Text type='secondary'>无</Text>
    },
    {
      title: '本地端口',
      dataIndex: 'localPort',
      key: 'localPort',
      width: 120,
      render: (localPort, tunnel) => isProxyTunnel(tunnel.type) ? localPort : <Text type='secondary'>无</Text>
    },
    {
      title: '远程端口',
      dataIndex: 'remotePort',
      key: 'remotePort',
      width: 120,
      render: (remotePort, tunnel) => isProxyTunnel(tunnel.type) ? remotePort : <Text type='secondary'>无</Text>
    },
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
    <div className='page-stack'>
      <div className='page-toolbar'>
        <div>
          <Title level={3}>隧道设置</Title>
          <Text type='secondary'>新增隧道时选择服务器，并写入对应服务器的 frpc_id.toml。</Text>
          {configPath && <div className='config-path'>最近配置：{configPath}</div>}
        </div>
        <Button disabled={!servers.length} type='primary' icon={<PlusOutlined />} onClick={openCreateModal}>新增隧道</Button>
      </div>
      <Table bordered columns={columns} dataSource={tunnels} pagination={false} scroll={{ x: 1760 }} />
      <Modal
        destroyOnHidden
        forceRender
        okText='保存'
        onCancel={closeModal}
        onOk={handleSaveTunnel}
        open={isModalOpen}
        title={editingTunnel ? '修改隧道' : '新增隧道'}
        width={720}
      >
        <Form
          className='server-form'
          form={form}
          initialValues={tunnelFormInitialValues}
          layout='vertical'
          onValuesChange={handleFormValuesChange}
        >
          <Form.Item label='服务器' name='serverId' rules={[{ required: true, message: '请选择服务器' }]}>
            <Select options={serverOptions} placeholder='请选择服务器' />
          </Form.Item>
          <div className='tunnel-form-grid'>
            <Form.Item label='类型' name='type' rules={[{ required: true, message: '请选择类型' }]}>
              <Select
                options={[
                  { label: 'stcp', value: 'stcp' },
                  { label: 'xtcp', value: 'xtcp' },
                  { label: 'tcp', value: 'tcp' },
                  { label: 'udp', value: 'udp' }
                ]}
              />
            </Form.Item>
            <Form.Item label='名称' name='name' rules={[{ required: true, message: '请输入名称' }]}>
              <Input placeholder={isProxyForm ? '例如 ssh' : '例如 og_new_visitor'} />
            </Form.Item>
          </div>
          {isProxyForm
            ? (
              <>
                <Form.Item label='本地IP' name='localIP' rules={[{ required: true, message: '请输入本地 IP' }]}>
                  <Input placeholder='127.0.0.1' />
                </Form.Item>
                <div className='tunnel-form-grid'>
                  <Form.Item
                    label='本地端口'
                    name='localPort'
                    rules={[
                      { required: true, message: '请输入本地端口' },
                      { type: 'number', min: 1, max: 65535, message: '端口范围为 1-65535' }
                    ]}
                  >
                    <InputNumber className='full-width' controls={false} placeholder='22' />
                  </Form.Item>
                  <Form.Item
                    label='远程端口'
                    name='remotePort'
                    rules={[
                      { required: true, message: '请输入远程端口' },
                      { type: 'number', min: 1, max: 65535, message: '端口范围为 1-65535' }
                    ]}
                  >
                    <InputNumber className='full-width' controls={false} placeholder='6000' />
                  </Form.Item>
                </div>
              </>
              )
            : (
              <>
                <div className='tunnel-form-grid'>
                  <Form.Item label='服务名' name='serviceName' rules={[{ required: true, message: '请输入服务名' }]}>
                    <Input placeholder='例如 og_new' />
                  </Form.Item>
                  <Form.Item label='秘钥' name='secretKey' rules={[{ required: true, message: '请输入秘钥' }]}>
                    <Input.Password autoComplete='new-password' placeholder='请输入 secretKey' />
                  </Form.Item>
                </div>
                <div className='tunnel-form-grid'>
                  <Form.Item label='绑定地址' name='bindAddr' rules={[{ required: true, message: '请输入绑定地址' }]}>
                    <Input placeholder='127.0.0.1' />
                  </Form.Item>
                  <Form.Item
                    label='绑定端口'
                    name='bindPort'
                    rules={[
                      { required: true, message: '请输入绑定端口' },
                      { type: 'number', min: 1, max: 65535, message: '端口范围为 1-65535' }
                    ]}
                  >
                    <InputNumber className='full-width' controls={false} placeholder='3000' />
                  </Form.Item>
                </div>
              </>
              )}
        </Form>
      </Modal>
      <Modal footer={[<Button key='close' onClick={closeLogModal}>关闭</Button>]} onCancel={closeLogModal} open={logModal.open} title={logModal.title} width={760}>
        <pre className='log-content'>{logModal.content}</pre>
      </Modal>
    </div>
  )
}

function EnvironmentSettings () {
  return (
    <div className='page-stack'>
      <Title level={3}>环境设置</Title>
      <Descriptions bordered column={1} size='middle'>
        <Descriptions.Item label='配置目录'>未设置</Descriptions.Item>
        <Descriptions.Item label='运行环境'>开发环境</Descriptions.Item>
        <Descriptions.Item label='自动启动'>关闭</Descriptions.Item>
      </Descriptions>
    </div>
  )
}

function renderPage (route, props) {
  if (route === 'server') return <ServerSettings {...props} />
  if (route === 'environment') return <EnvironmentSettings />
  return <TunnelSettings {...props} />
}

export default function App () {
  const [messageApi, contextHolder] = message.useMessage()
  const [collapsed, setCollapsed] = useState(true)
  const [route, setRoute] = useState('tunnel')
  const [servers, setServers] = useState(initialServers)
  const [tunnels, setTunnels] = useState(initialTunnels)
  const [runningTunnels, setRunningTunnels] = useState({})
  const [configPath, setConfigPath] = useState('')

  const persistServerConfig = (server, allTunnels) => {
    try {
      const filePath = writeServerFrpcToml(server, allTunnels)
      setConfigPath(filePath)
      messageApi.success(`已写入 ${filePath}`)
    } catch (error) {
      messageApi.error(`写入 ${server.configFile} 失败：${error.message}`)
    }
  }

  useEffect(() => {
    if (!window.utools?.onPluginEnter) return

    window.utools.onPluginEnter((action) => {
      if (pageTitles[action.code]) setRoute(action.code)
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
        <Sider collapsed={collapsed} collapsedWidth={72} trigger={null} width={220}>
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
              configPath,
              messageApi,
              persistServerConfig,
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
