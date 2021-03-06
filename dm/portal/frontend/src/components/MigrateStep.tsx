import React, { useState, useMemo, useRef } from 'react'
import { Button, Icon, Tree, Tooltip, message, Checkbox } from 'antd'
import { AntTreeNodeSelectedEvent } from 'antd/lib/tree'
import { AntTreeNodeDropEvent, AntTreeNodeMouseEvent } from 'antd/lib/tree/Tree'
import styled from 'styled-components'
import { FormattedMessage, useIntl } from 'react-intl'
import {
  IPageAction,
  IFullInstance,
  IKey,
  IFullSchema,
  IFullTable,
  IFullSchemas,
  IFullInstances,
  IFullTables,
  ISourceConfig,
  ITaskInfo,
  IInstances
} from '../types'
import BinlogFilterModal from './BinlogFilterModal'
import { genFinalConfig } from '../utils/config-util'
import { generateConfig, downloadConfig } from '../services/api'

const { TreeNode } = Tree

const Container = styled.div`
  max-width: 800px;
  margin: 0 auto;

  .dbtable-shuttle-container {
    display: flex;
    justify-content: space-around;
  }

  .tree-container {
    position: relative;
    border: 1px solid #ccc;
    border-radius: 4px;
    padding: 8px;
    width: 300px;
    min-height: 300px;
    max-height: 600px;
    overflow-y: scroll;
  }

  .shuttle-arrows {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;

    button {
      margin-bottom: 20px;
    }
  }

  .action-buttons {
    display: flex;
    justify-content: center;

    button {
      margin: 24px;
      margin-top: 48px;
    }
  }

  .ant-tree li .ant-tree-node-content-wrapper.ant-tree-node-selected {
    background: #475edd;
    color: white;
  }

  .ant-tree-title {
    display: block;
    position: relative;
  }

  .edit-icon {
    position: absolute;
    color: black;
    top: 5px;
    right: -30px;
  }

  .action-icons {
    position: absolute;
    top: 10px;
    right: 10px;
  }

  .auto-sync-option {
    margin-top: 10px;
    width: 300px;
  }
`

type LastStateRef = {
  lastSourceSchemas: IFullSchemas
  lastAllTables: IFullTables
  lastTargetSchemas: IFullSchemas
}

function existedSchemaNames(schemas: IFullSchemas) {
  return Object.keys(schemas)
    .map(key => schemas[key])
    .map(item => item.newName)
}

function loopGenUniqueName(oriName: string, existNames: string[]): string {
  if (!existNames.includes(oriName)) {
    return oriName
  }
  return loopGenUniqueName(`${oriName}_1`, existNames)
}

function genRandSuffix() {
  return `${Date.now()}_${Math.floor(Math.random() * 1000)}`
}

type Props = IPageAction<any> & {
  taskInfo: ITaskInfo
  instancesConfig: IInstances
  sourceConfig: ISourceConfig
  targetSchemas: IFullSchemas
}

function MigrateStep({ onNext, onPrev, sourceConfig, ...remainProps }: Props) {
  const intl = useIntl()

  const sourceInstances: IFullInstances = sourceConfig.sourceInstances
  const [sourceSchemas, setSourceSchemas] = useState<IFullSchemas>(
    sourceConfig.sourceSchemas
  )
  const [allTables, setAllTables] = useState<IFullTables>(
    sourceConfig.allTables
  )
  const [targetSchemas, setTargetSchemas] = useState<IFullSchemas>(
    remainProps.targetSchemas
  )
  const [selectedSourceItem, setSelectedSourceItem] = useState<IKey>({
    key: ''
  })
  const [selectedTargetItem, setSelectedTargetItem] = useState<IKey>({
    key: ''
  })

  // modal
  const [modalVisible, setModalVisible] = useState(false)

  // button loading
  const [loading, setLoading] = useState(false)

  // checked keys
  const [sourceCheckedKeys, setSourceCheckedKeys] = useState<string[]>([])
  const [targetCheckedKeys, setTargetCheckedKeys] = useState<string[]>([])

  const enableMoveRight = useMemo(() => sourceCheckedKeys.length > 0, [
    sourceCheckedKeys
  ])

  const enableMoveLeft = useMemo(() => targetCheckedKeys.length > 0, [
    targetCheckedKeys
  ])

  const enableDrag = useMemo(
    // schema ???????????????????????? table ??????
    () => selectedTargetItem.key.split(':').length > 2,
    [selectedTargetItem]
  )

  const targetInstance: IFullInstance = useMemo(
    () => ({
      type: 'instance',
      sourceId: 'target-instance',
      key: 'target-instance',
      schemas: Object.keys(targetSchemas)
    }),
    [targetSchemas]
  )

  // ???????????????????????????????????????????????? lastStateRef
  const lastStateRef = useRef<LastStateRef | null>(null)

  // ??????????????????????????????????????????????????????
  const [autoSyncUpstream, setAutoSyncUpstream] = useState(false)

  /////////////////////////////////

  function cleanTargetInstance() {
    // confirm
    if (!window.confirm(intl.formatMessage({ id: 'reset_confirm' }))) {
      return
    }

    // ?????????????????? table ????????????
    const tableKeys = Object.keys(allTables).filter(tableKey => {
      const table = allTables[tableKey]
      return table.parentKey !== '' && table.type === 'table'
    })
    moveMultiTablesLeft(tableKeys)

    // clean
    setSelectedTargetItem({ key: '' })
    setTargetCheckedKeys([])
    // undo ????????????
    lastStateRef.current = null
  }

  function undo() {
    // confirm
    if (!window.confirm(intl.formatMessage({ id: 'undo_confirm' }))) {
      return
    }

    console.log(lastStateRef.current)

    setSourceSchemas(lastStateRef.current!.lastSourceSchemas)
    setAllTables(lastStateRef.current!.lastAllTables)
    setTargetSchemas(lastStateRef.current!.lastTargetSchemas)
    lastStateRef.current = null
  }

  function recordLastState() {
    // deep copy
    // not elegant, need to polish later
    lastStateRef.current = {
      lastSourceSchemas: JSON.parse(JSON.stringify(sourceSchemas)),
      lastAllTables: JSON.parse(JSON.stringify(allTables)),
      lastTargetSchemas: JSON.parse(JSON.stringify(targetSchemas))
    }
  }

  /////////////////////////////////

  function onSelectSourceItem(
    selectedKeys: string[],
    e: AntTreeNodeSelectedEvent
  ) {
    const { node, selected } = e
    console.log(node.props.dataRef)
    setSelectedSourceItem(selected ? node.props.dataRef : { key: '' })
  }

  function onSelectTargetItem(
    selectedKeys: string[],
    e: AntTreeNodeSelectedEvent
  ) {
    const { node, selected } = e
    console.log(node.props.dataRef)
    setSelectedTargetItem(selected ? node.props.dataRef : { key: '' })
  }

  function onEditIconClick(e: any) {
    e.stopPropagation()
    setModalVisible(true)
  }

  /////////////////////////////////

  function onSourceCheck(checkedKeys: any) {
    console.log(checkedKeys)
    setSourceCheckedKeys(checkedKeys as string[])
  }

  function onTargetCheck(checkedKeys: any) {
    console.log(checkedKeys)
    setTargetCheckedKeys(checkedKeys as string[])
  }

  /////////////////////////////////

  function moveRight() {
    recordLastState()

    // ??????
    // 1. ???????????? source checked keys
    // 2. ?????? source checked keys???????????? table keys?????????????????? table ????????? schema key?????? table key ??????????????? schema key ???????????????
    // 3. ??? schema key ??????????????????????????? schema key ??????????????? target schema
    // 4. ?????? schema key ????????? source schema?????? tables ???????????????????????? table key

    // 1. ???????????? source checked keys
    setSourceCheckedKeys([])

    // 2. ?????? source checked keys???????????? table keys?????????????????? table ????????? schema key?????? table key ??????????????? schema key ???????????????
    const schemaTablesMap: { [key: string]: string[] } = {}
    sourceCheckedKeys.forEach(oriKey => {
      const keyArr = oriKey.split(':')
      // ?????? table key
      if (keyArr.length !== 3) {
        return
      }
      const schemaKey = keyArr.slice(0, 2).join(':')
      if (schemaTablesMap[schemaKey] === undefined) {
        schemaTablesMap[schemaKey] = []
      }
      schemaTablesMap[schemaKey].push(oriKey)
    })

    // 3. ??? schema key ??????????????????????????? schema key ??????????????? target schema
    // 4. ?????? schema key ????????? source schema?????? tables ???????????????????????? table key
    // 5. ??????????????? table ??? parentKey
    const newSourceSchemas = { ...sourceSchemas }
    const newTargetSchemas = { ...targetSchemas }
    const newAllTables = { ...allTables }
    Object.keys(schemaTablesMap).forEach(schemaKey => {
      const sourceSchema = newSourceSchemas[schemaKey]
      // ?????? source schema
      sourceSchema.tables = sourceSchema.tables.filter(
        t => !schemaTablesMap[schemaKey].includes(t)
      )

      // ???????????? target schema
      const newName = loopGenUniqueName(
        sourceSchema.schema,
        existedSchemaNames(newTargetSchemas)
      )
      const targetSchema: IFullSchema = {
        ...sourceSchema,
        key: `${sourceSchema.key}_${genRandSuffix()}`,
        newName,
        tables: schemaTablesMap[schemaKey]
      }
      newTargetSchemas[targetSchema.key] = targetSchema
      newSourceSchemas[sourceSchema.key] = { ...sourceSchema }

      // ?????? table ??? parentKey
      targetSchema.tables.forEach(tblKey => {
        newAllTables[tblKey].parentKey = targetSchema.key
      })
    })
    setSourceSchemas(newSourceSchemas)
    setTargetSchemas(newTargetSchemas)
    setAllTables(newAllTables)
  }

  /////////////////////////////////

  function moveLeft() {
    console.log('moveLeft')
    console.log((selectedTargetItem as any).mergedTables)
    // !! weird, their value are different in the chrome console tab, is the chrome or react's bug?
    // TODO: check in other browser
    // console.log(selectedTargetItem)
    // console.log(JSON.stringify(selectedTargetItem))
    // console.log(selectedTargetItem.toString())
    // console.log('target', targetSchemas)
    // ????????????????????????????????????????????????????????????????????????????????????
    // ??? chrome ??? inspect ???????????? console.log(obj) ???????????????
    // ???????????????????????????????????????????????????????????????????????????????????????????????????
    recordLastState()
    // console.log('current:', lastStateRef.current)

    // 1. ?????? target checked keys
    setTargetCheckedKeys([])

    // 2. ????????? table keys
    const tableKeys = targetCheckedKeys
      .filter(key => key.split(':').length === 3)
      .filter(tblKey => allTables[tblKey].type === 'table')

    // console.log(tableKeys)
    moveMultiTablesLeft(tableKeys)
    // console.log('current', lastStateRef.current)
  }

  function moveMultiTablesLeft(tableKeys: string[]) {
    const newAllTables: IFullTables = { ...allTables }
    const newSourceSchemas: IFullSchemas = { ...sourceSchemas }
    const newTargetSchemas: IFullSchemas = { ...targetSchemas }

    // ??????????????????????????? table ??????
    tableKeys.forEach(tableKey => {
      const movedTable = newAllTables[tableKey]

      // 2. ??? sourceSchema ??? tables ????????? movedTable.key
      const sourceSchemaKey = `${movedTable.sourceId}:${movedTable.schema}`
      const sourceSchema = newSourceSchemas[sourceSchemaKey]
      sourceSchema.tables = sourceSchema.tables.concat(movedTable.key)

      // 3. updateMovedTableParent
      updateMovedTableParent(movedTable, newTargetSchemas, newAllTables, false)

      // 1. ?????? movedTable????????? newName????????? parentKey
      // ????????????????????????????????????????????? updateMovedTableParent ????????????????????? movedTable.parentKey
      movedTable.newName = movedTable.table
      movedTable.parentKey = ''
    })

    // setState
    setAllTables(newAllTables)
    setSourceSchemas(newSourceSchemas)
    setTargetSchemas(newTargetSchemas)
  }

  /////////////////////////////////

  function onDrop(info: AntTreeNodeDropEvent) {
    // ?????????????????????????????? updateMovedTableParent()
    // ????????? updateMovedTableParent() ??????????????? lastState

    if (info.dropToGap) {
      // not support
      return
    }
    const dragItem = info.dragNode.props.dataRef
    const dropItem = info.node.props.dataRef
    if ((dragItem as IFullTable).type === 'table') {
      // dropItem: instance, schema, merged table, table, table belongs to merged table
      if ((dropItem as IFullInstance).type === 'instance') {
        // ???????????? schema
        moveTableToTop(dragItem as IFullTable)
      } else if ((dropItem as IFullSchema).type === 'schema') {
        // ?????????????????? schema???put it inside
        moveTableToSchema(dragItem as IFullTable, dropItem as IFullSchema)
      } else if ((dropItem as IFullTable).type === 'mergedTable') {
        // ??????????????????????????????put it inside
        moveTableToMergedTable(dragItem as IFullTable, dropItem as IFullTable)
      } else if ((dropItem as IFullTable).type === 'table') {
        // ?????????????????????
        mergeTables(dragItem as IFullTable, dropItem as IFullTable)
      }
    } else if ((dragItem as IFullTable).type === 'mergedTable') {
      // dropItem: instance, schema, merged table, table, table belongs to merged table
      if ((dropItem as IFullInstance).type === 'instance') {
        moveTableToTop(dragItem as IFullTable)
        // create new schema
      } else if ((dropItem as IFullSchema).type === 'schema') {
        // move it
        moveTableToSchema(dragItem as IFullTable, dropItem as IFullSchema)
      } else if ((dropItem as IFullTable).type === 'mergedTable') {
        return
      } else if ((dropItem as IFullTable).type === 'table') {
        return
      }
    }
  }

  function updateMovedTableParent(
    movedTable: IFullTable,
    newTargetSchemas: IFullSchemas,
    newAllTables: IFullTables,
    setStateInside: boolean = true
  ) {
    // ?????? lastState
    if (setStateInside) {
      recordLastState()
    }

    // ?????? movedTable ??? parent
    //
    // ????????? parent ??? schema????????? tables ????????? movedTableKey????????????????????? tables ???????????? targetSchemas ???????????? schema
    //
    // ????????? parent ??? mergedTable?????? mergedTables ????????? movedTableKey????????????????????? mergedTables ???????????? allTables ???????????? mergedTable
    // ?????? parent schema tables ???????????? mergedTable????????? parent schema tables ???????????? targetSchemas ???????????? schema

    const parentKey = movedTable.parentKey
    const keyArrLen = parentKey.split(':').length
    if (keyArrLen === 2) {
      // movedTable parent is schema
      const tableParent = newTargetSchemas[parentKey]
      tableParent.tables = tableParent.tables.filter(t => t !== movedTable.key)
      if (tableParent.tables.length === 0) {
        delete newTargetSchemas[parentKey]
      }
    } else if (keyArrLen === 3) {
      // movedTable parent is mergedTable
      const tableParent = newAllTables[parentKey]
      tableParent.mergedTables = tableParent.mergedTables!.filter(
        t => t !== movedTable.key
      )
      if (tableParent.mergedTables.length === 0) {
        delete newAllTables[tableParent.key]

        // ???????????? schema
        const tableParentParent = newTargetSchemas[tableParent.parentKey]
        tableParentParent.tables = tableParentParent.tables.filter(
          t => t !== tableParent.key
        )
        if (tableParentParent.tables.length === 0) {
          delete newTargetSchemas[tableParentParent.key]
        }
      }
    }
    if (setStateInside) {
      setTargetSchemas(newTargetSchemas)
      setAllTables(newAllTables)
    }
  }

  function moveTableToTop(movedTable: IFullTable) {
    console.log('?????? table ????????????????????? newdatabase')

    // ???????????? schema?????? tables ??? movedTable
    // ????????? schema ?????? newName ??? newKey
    // ?????? movedTable?????? parentKey ???????????? schema
    // ----- ?????????????????????????????? - ????????? updateMovedTableParent()
    // ?????? movedTable ??? parent
    // ????????? parent ??? schema?????? tables ????????? movedTableKey????????????????????? tables ???????????? targetSchemas ???????????? schema
    // ????????? parent ??? mergedTable?????? mergedTables ????????? movedTableKey????????????????????? mergedTables ???????????? allTables ???????????? mergedTable
    // ?????? parent schema tables ???????????? mergedTable????????? parent schema tables ???????????? targetSchemas ???????????? schema

    // 1. create new schema, gen new name and new key
    const newSchema: IFullSchema = {
      type: 'schema',
      sourceId: 'new',
      schema: 'newdatabase',
      key: `new:newdatabase_${genRandSuffix()}`,
      tables: [movedTable.key],
      newName: 'newdatabase',
      filters: []
    }
    const existedNames = Object.keys(targetSchemas).map(
      schemaKey => targetSchemas[schemaKey].newName
    )
    newSchema.newName = loopGenUniqueName('newdatabase', existedNames)
    const newTargetSchemas: IFullSchemas = {
      ...targetSchemas,
      [newSchema.key]: newSchema
    }

    // 2. change targetTable parentKey
    const newAllTables: IFullTables = {
      ...allTables,
      [movedTable.key]: {
        ...movedTable,
        parentKey: newSchema.key
      }
    }

    // ??? parent ??? schema ?????? merged table
    // 3. update its parent
    updateMovedTableParent(movedTable, newTargetSchemas, newAllTables)
  }

  function moveTableToSchema(
    movedTable: IFullTable,
    targetSchema: IFullSchema
  ) {
    console.log('?????? table ??? schema ???')

    // ?????? table ??? parent ??? schema ?????? mergedTable
    //
    // ????????? parent ??? schema?????????????????? schema ????????????????????????????????????????????????????????????????????????
    // ??????
    // 1. ??? movedTable ???????????? schema ???????????????????????? newName ??? parentKey
    // 2. ?????? schema ??? tables ?????? movedTable
    // 3. parent schema tables ?????? movedTable????????? tables length ??? 0?????? targetSchema ????????? (?????? updateMovedTableParent() ????????????)
    //
    // ?????? parent ??? mergedTable
    // 1. ??? movedTable ???????????? schema ???????????????????????? newName ??? parentKey
    // 2. ??? ?????? schema ??? tables ?????? movedTable
    // 3. ?????? parent mergedTable????????? updateMovedTableParent() ????????????
    //
    // ??????????????????????????????????????????????????????????????????
    //
    // ???????????????????????????????????????????????????????????????
    // 1. ??? movedTable ?????? newName????????? parentKey??????????????? schema ??? mergedTable
    // 2. ???????????? schema ??? mergedTable????????? movedTable.key
    // 3. ?????? updateMovedTableParent() ??????

    const tableParentKey = movedTable.parentKey
    const keyArrLen = tableParentKey.split(':').length
    if (
      keyArrLen === 2 &&
      targetSchemas[tableParentKey].key === targetSchema.key
    ) {
      // parent is schema, and same as the target schema
      return
    }

    // update targetTable: newName, parentKey
    const existNames = targetSchema.tables.map(
      tableKey => allTables[tableKey].newName
    )
    const newName = loopGenUniqueName(movedTable.newName, existNames)
    const newAllTables: IFullTables = {
      ...allTables,
      [movedTable.key]: {
        ...movedTable,
        newName,
        parentKey: targetSchema.key
      }
    }
    const newTargetSchemas: IFullSchemas = {
      ...targetSchemas,
      [targetSchema.key]: {
        ...targetSchema,
        tables: targetSchema.tables.concat(movedTable.key)
      }
    }
    updateMovedTableParent(movedTable, newTargetSchemas, newAllTables)
  }

  function moveTableToMergedTable(
    movedTable: IFullTable,
    mergedTable: IFullTable
  ) {
    console.log('?????? table ??? mergedTable ???')

    // ?????? movedTable parent ??? schema
    // 1. ??? movedTable ?????? newName???parentKey ?????? mergedTable
    // 2. ??? movedTable.key ?????? mergedTable ???
    // 3. ?????? updateMovedTableParent() ??????
    //
    // ?????? movedTable parent ??? mergedTable
    // ???????????? parent ????????? mergedTable ??????????????????????????????????????????????????????????????????????????????

    const tableParentKey = movedTable.parentKey
    const keyArrLen = tableParentKey.split(':').length
    if (keyArrLen === 3 && allTables[tableParentKey].key === mergedTable.key) {
      // parent is same as the target mergedTable
      return
    }

    // 1. newName
    const existNames = mergedTable.mergedTables!.map(
      tableKey => allTables[tableKey].newName
    )
    const newName = loopGenUniqueName(movedTable.newName, existNames)
    const newAllTables: IFullTables = {
      ...allTables,
      [movedTable.key]: {
        ...movedTable,
        newName,
        parentKey: mergedTable.key
      },
      [mergedTable.key]: {
        ...mergedTable,
        mergedTables: mergedTable.mergedTables!.concat(movedTable.key)
      }
    }
    const newTargetSchemas = { ...targetSchemas }
    updateMovedTableParent(movedTable, newTargetSchemas, newAllTables)
  }

  function mergeTables(movedTable: IFullTable, targetTable: IFullTable) {
    console.log(
      '??? table ????????? table?????????????????? table??????????????????????????????????????? targetTable ????????? mergedTable'
    )

    // ???????????? targetTable ??? parent ??? schema ?????? mergedTable?????????????????????????????????????????????????????????
    // ????????? targetTable ????????? mergedTable?????????????????????????????????????????????
    // ????????????????????????????????????????????????????????? movedTable ??? targetTable ??? parent
    //
    // ?????? movedTable parent ??? schema
    // 1. ???????????????????????? newName ??? key???parentKey ??? targetTable.parentKey???mergedTables ??? movedTable ??? targetTable?????? allTables ??????????????????????????????
    // 2. ?????? movedTable ??? targetTable?????? parentKey ??????????????? mergedTable??????????????????????????????????????? movedTable
    // 3. ?????? targetTable ??? parent schema????????? tables ????????? targetTable????????? mergedTable
    // 4. ?????? updateMovedTableParent()
    //
    // ?????? movedTable parent ??? mergedTable
    // ?????????????????????????????????...

    const targetTableParentKey = targetTable.parentKey
    if (targetTableParentKey.split(':').length === 3) {
      // targetTable parent is mergedTable
      // ???????????????????????????
      return
    }

    const targetTableParent = targetSchemas[targetTableParentKey]
    // 1. ???????????????
    const newMergedTable: IFullTable = {
      type: 'mergedTable',
      sourceId: 'new',
      schema: 'new',
      table: 'newtable',
      newName: 'newtable',
      key: `new:new:newtable_${genRandSuffix()}`,
      parentKey: targetTableParentKey,
      mergedTables: [movedTable.key, targetTable.key],
      filters: []
    }
    const existNames = targetTableParent.tables.map(
      tableKey => allTables[tableKey].newName
    )
    newMergedTable.newName = loopGenUniqueName(
      newMergedTable.newName,
      existNames
    )
    // 2. ?????? movedTable ??? targetTable
    if (movedTable.newName === targetTable.newName) {
      movedTable.newName = `${movedTable.newName}_1`
    }
    const newAllTables: IFullTables = {
      ...allTables,
      [newMergedTable.key]: newMergedTable,
      [movedTable.key]: {
        ...movedTable,
        parentKey: newMergedTable.key
      },
      [targetTable.key]: {
        ...targetTable,
        parentKey: newMergedTable.key
      }
    }
    // 3. ?????? targetSchema
    const newTargetSchemas: IFullSchemas = {
      ...targetSchemas,
      [targetTableParentKey]: {
        ...targetTableParent,
        tables: targetTableParent.tables
          .filter(t => t !== targetTable.key)
          .concat(newMergedTable.key)
      }
    }
    // 4. updateMovedTableParent
    updateMovedTableParent(movedTable, newTargetSchemas, newAllTables)
  }

  /////////////////////////////////

  function renameNode(options: AntTreeNodeMouseEvent) {
    const targetItem = options.node.props.dataRef
    if ((targetItem as IFullInstance).type === 'instance') {
      return
    }
    const newName = prompt(
      intl.formatMessage({ id: 'new_name' }),
      targetItem.newName
    )
    if (newName === null || newName === targetItem.newName) {
      // click cancel or change nothing
      return
    }
    if (newName === '') {
      alert(intl.formatMessage({ id: 'name_can_not_empty' }))
      return
    }
    let existNames: string[] = []
    if ((targetItem as IFullSchema).type === 'schema') {
      existNames = Object.keys(targetSchemas).map(
        schemaKey => targetSchemas[schemaKey].newName
      )
    } else if ((targetItem as IFullTable).type === 'mergedTable') {
      const tableParent = targetSchemas[targetItem.parentKey]
      existNames = tableParent.tables.map(
        tableKey => allTables[tableKey].newName
      )
    } else if ((targetItem as IFullTable).type === 'table') {
      const tableParentKey = targetItem.parentKey
      if (tableParentKey.split(':').length === 2) {
        // parent is schema
        const tableParent = targetSchemas[targetItem.parentKey]
        existNames = tableParent.tables.map(
          tableKey => allTables[tableKey].newName
        )
      } else {
        // parent is mergedTable
        const tableParent = allTables[targetItem.parentKey]
        existNames = tableParent.mergedTables!.map(
          tableKey => allTables[tableKey].newName
        )
      }
    }
    const nameExisted = existNames.includes(newName)
    if (nameExisted) {
      alert(intl.formatMessage({ id: 'name_taken' }))
      return
    }

    recordLastState()

    if ((targetItem as IFullSchema).type === 'schema') {
      setTargetSchemas({
        ...targetSchemas,
        [targetItem.key]: {
          ...targetItem,
          newName
        }
      })
    } else {
      setAllTables({
        ...allTables,
        [targetItem.key]: {
          ...targetItem,
          newName
        }
      })
    }
  }

  /////////////////////////////////

  function onUpdateItemFilters(item: IFullSchema | IFullTable) {
    setSelectedSourceItem(item) // update it, because we generate a new source item object

    if ((item as IFullTable).type === 'table') {
      setAllTables({
        ...allTables,
        [item.key]: item as IFullTable
      })
    } else if ((item as IFullSchema).type === 'schema') {
      const schema = item as IFullSchema
      const newSourceSchemas = {
        ...sourceSchemas,
        [schema.key]: schema
      }

      // ??????????????? table ??? filters ??????
      const newAllTables = { ...allTables }
      // ??? PM ????????????????????? db ??? binlog ??????????????????????????????????????? tables??????????????????????????????????????? tables
      // const schemaTables: IFullTable[] = Object.keys(newAllTables)
      //   .map(tableKey => newAllTables[tableKey])
      //   .filter(
      //     table =>
      //       table.sourceId === schema.sourceId && table.schema === schema.schema
      //   )
      // schemaTables.forEach(table => (table.filters = schema.filters))
      schema.tables.forEach(
        tableKey => (newAllTables[tableKey].filters = schema.filters)
      )

      setSourceSchemas(newSourceSchemas)
      setAllTables(newAllTables)
    }
  }

  /////////////////////////////////

  async function handleSubmit() {
    setLoading(true)
    const { taskInfo, instancesConfig } = remainProps
    const finalConfig = genFinalConfig(
      taskInfo,
      instancesConfig,
      sourceSchemas,
      targetSchemas,
      allTables,
      autoSyncUpstream
    )
    let res = await generateConfig(finalConfig)
    setLoading(false)
    if (res.err) {
      message.error(intl.formatMessage({ id: 'config_create_fail' }))
      return
    }
    message.info(
      intl.formatMessage(
        { id: 'config_create_ok' },
        { filepath: res.data.filepath }
      )
    )
    downloadConfig(res.data.filepath)
  }

  /////////////////////////////////

  function goHome() {
    if (window.confirm(intl.formatMessage({ id: 'back_home_confirm' }))) {
      onNext()
    }
  }

  /////////////////////////////////

  function renderSourceTables() {
    const sourceInstancesArr: IFullInstance[] = Object.keys(
      sourceInstances
    ).map(key => sourceInstances[key])
    return (
      <Tree
        showLine
        onSelect={onSelectSourceItem}
        checkable
        checkedKeys={sourceCheckedKeys}
        onCheck={onSourceCheck}
      >
        {sourceInstancesArr.map(instance => (
          <TreeNode
            key={instance.key}
            title={instance.sourceId}
            selectable={false}
          >
            {instance.schemas
              .filter(schemaKey => sourceSchemas[schemaKey].tables.length > 0)
              .map(schemaKey => (
                <TreeNode
                  key={sourceSchemas[schemaKey].key}
                  title={
                    selectedSourceItem.key === schemaKey ? (
                      <>
                        {sourceSchemas[schemaKey].schema}{' '}
                        <Icon
                          className="edit-icon"
                          type="edit"
                          onClick={onEditIconClick}
                        />
                      </>
                    ) : (
                      sourceSchemas[schemaKey].schema
                    )
                  }
                  dataRef={sourceSchemas[schemaKey]}
                >
                  {sourceSchemas[schemaKey].tables.map(tableKey => (
                    <TreeNode
                      key={allTables[tableKey].key}
                      title={
                        selectedSourceItem.key === tableKey ? (
                          <>
                            {allTables[tableKey].table}{' '}
                            <Icon
                              className="edit-icon"
                              type="edit"
                              onClick={onEditIconClick}
                            />
                          </>
                        ) : (
                          allTables[tableKey].table
                        )
                      }
                      dataRef={allTables[tableKey]}
                    />
                  ))}
                </TreeNode>
              ))}
          </TreeNode>
        ))}
      </Tree>
    )
  }

  function renderTargetTables() {
    return (
      <Tree
        showLine
        draggable={enableDrag}
        onSelect={onSelectTargetItem}
        onDrop={onDrop}
        onRightClick={renameNode}
        checkable
        checkedKeys={targetCheckedKeys}
        onCheck={onTargetCheck}
      >
        <TreeNode
          title={targetInstance.sourceId}
          key={targetInstance.key}
          dataRef={targetInstance}
          selectable={false}
        >
          {targetInstance.schemas
            .map(schemaKey => targetSchemas[schemaKey])
            .map(schema => (
              <TreeNode
                title={
                  <Tooltip
                    title={`${schema.sourceId}:${schema.schema}`}
                    placement="right"
                  >
                    {schema.newName}
                  </Tooltip>
                }
                key={schema.key}
                dataRef={schema}
              >
                {schema.tables
                  .map(tableKey => allTables[tableKey])
                  .map(table => (
                    <TreeNode
                      title={
                        <Tooltip
                          placement="right"
                          title={`${table.sourceId}:${table.schema}:${table.table}`}
                        >
                          {table.newName}
                        </Tooltip>
                      }
                      key={table.key}
                      dataRef={table}
                    >
                      {table.mergedTables &&
                        table
                          .mergedTables!.map(tbKey => allTables[tbKey])
                          .map(tb => (
                            <TreeNode
                              title={
                                <Tooltip
                                  placement="right"
                                  title={`${tb.sourceId}:${tb.schema}:${tb.table}`}
                                >
                                  {tb.newName}
                                </Tooltip>
                              }
                              key={tb.key}
                              dataRef={tb}
                            />
                          ))}
                    </TreeNode>
                  ))}
              </TreeNode>
            ))}
        </TreeNode>
      </Tree>
    )
  }

  return (
    <Container>
      <div className="dbtable-shuttle-container">
        <div>
          <h2>
            <FormattedMessage id="upstream" />
          </h2>
          <div className="tree-container">{renderSourceTables()}</div>
          <div className="auto-sync-option">
            <Checkbox
              checked={autoSyncUpstream}
              onChange={e => setAutoSyncUpstream(e.target.checked)}
            >
              <FormattedMessage id="auto_sync" />
              &nbsp;
              <Tooltip title={intl.formatMessage({ id: 'auto_sync_explain' })}>
                <Icon type="question-circle" />
              </Tooltip>
            </Checkbox>
          </div>
        </div>
        <div className="shuttle-arrows">
          <Button disabled={!enableMoveRight} onClick={moveRight}>
            <Icon type="arrow-right" />
          </Button>
          <Button disabled={!enableMoveLeft} onClick={moveLeft}>
            <Icon type="arrow-left" />
          </Button>
        </div>
        <div>
          <h2>
            <FormattedMessage id="downstream" />
          </h2>
          <div className="tree-container">
            {renderTargetTables()}
            <div className="action-icons">
              <Tooltip title={intl.formatMessage({ id: 'go_back_tooltip' })}>
                <Button onClick={undo} disabled={lastStateRef.current === null}>
                  <Icon type="undo" />
                </Button>
              </Tooltip>
              <span>&nbsp;</span>
              <Tooltip title={intl.formatMessage({ id: 'reset_tooltip' })}>
                <Button
                  onClick={cleanTargetInstance}
                  disabled={targetInstance.schemas.length === 0}
                >
                  <Icon type="delete" />
                </Button>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
      <div className="action-buttons">
        <Button onClick={() => onPrev()}>
          <FormattedMessage id="pre" />
        </Button>
        <Button type="primary" onClick={handleSubmit} loading={loading}>
          <FormattedMessage id="finish_and_download" />
        </Button>
        <Button onClick={goHome}>
          <FormattedMessage id="go_home" />
        </Button>
      </div>
      <BinlogFilterModal
        key={selectedSourceItem.key + `${Date.now()}`}
        targetItem={selectedSourceItem as any}
        modalVisible={modalVisible}
        onCloseModal={() => setModalVisible(false)}
        onUpdateItem={onUpdateItemFilters}
      />
    </Container>
  )
}

export default MigrateStep
