const argparse = require('argparse')
const VirtualMachine = require('scratch-vm')
const JSZip = require('jszip')
const fs = require('fs/promises')
const { runtimeFunctions } = require('scratch-vm/src/compiler/jsexecute')
const log = require('scratch-vm/src/util/log')
const { version } = require('../package.json')
const uid = require('./uid.cjs')
const UglifyJS = require('uglify-js')

const parser = argparse.ArgumentParser({
  description: 'Precompile a Scratch project using Kylin compiler.'
})
parser.add_argument('-v', '--version', { action: 'version', version })
parser.add_argument('SOURCE', {
  help: 'Source file',
  type: 'str'
})
parser.add_argument('DEST', {
  help: 'Destination file',
  type: 'str'
})
;(async args => {
  // only displays error
  log.log = log.info = log.warning = log.warn = () => {}
  function obfuscateCode(code) {
    const result = UglifyJS.minify(code, {
      compress: true,
      expression: true,
      toplevel: true
    })
    if (result.error) console.error(result.error)
    return result.code
  }
  console.log('📄 Fetching metadata from the project')
  const zip = await JSZip.loadAsync(await fs.readFile(args.SOURCE))
  const source = JSON.parse(await zip.file('project.json').async('string'))
  const project = structuredClone(source)
  const yOffset = 150
  const xOffset = 250
  const vm = new VirtualMachine()
  await vm.loadProject(source)
  console.log('🤖 Compiling the project')
  vm.runtime.precompile()
  console.group('🛠️ Rebuilding the project with compiled code')
  for (const [index, target] of Object.entries(vm.runtime.targets)) {
    console.group(`👾 Working in sprite ${target.sprite.name}`)
    let hasBlock = false
    let yIndex = 0
    let xIndex = 0
    project.targets[index].blocks = {}
    // delete comments
    for (const [id, value] of Object.entries(project.targets[index].comments)) {
      if (
        !project.targets[index].isStage ||
        !value.text.endsWith('// _twconfig_')
      )
        delete project.targets[index].comments[id]
    }
    // compile all code below the hat to Javascript
    for (const [hatId, compiledResult] of Object.entries(
      target.blocks._cache.compiledScripts
    )) {
      if (compiledResult.success) {
        // 拷贝 hat
        const hat = (project.targets[index].blocks[hatId] = structuredClone(
          source.targets[index].blocks[hatId]
        ))
        if (hat.x !== undefined && hat.x !== undefined) {
          if (yIndex > 5) {
            yIndex = 0
            xIndex++
          }
          hat.x = xIndex * xOffset
          hat.y = yIndex * yOffset
          yIndex++
        }
        if (hat.next) {
          hasBlock = true
          project.targets[index].blocks[hat.next] = {
            opcode: 'kylin_compile',
            next: null,
            parent: hatId,
            inputs: {
              CODE: [
                1,
                [
                  10,
                  obfuscateCode(
                    compiledResult.value.startingFunction.toString()
                  )
                ]
              ]
            },
            fields: {},
            shadow: false,
            topLevel: false
          }
          console.log(`🖋️ Rebuilding hat ${hatId}`)
        }
      } else {
        // Maybe we should just keep the hat and blocks below when it fails to compile... Whatever.
        console.error(`❌ Failed to rebuild hat ${hatId}: compilation failed`)
      }
    }
    // Rebuild procedures with compiled Javascript.
    for (const procedureInfo of Object.values(
      target.blocks._cache.compiledProcedures
    )) {
      const definition = (project.targets[index].blocks[
        procedureInfo.topBlockId
      ] = structuredClone(
        source.targets[index].blocks[procedureInfo.topBlockId]
      ))
      if (definition.x !== undefined && definition.x !== undefined) {
        if (yIndex > 5) {
          yIndex = 0
          xIndex++
        }
        definition.x = xIndex * xOffset
        definition.y = yIndex * yOffset
        yIndex++
      }
      const prototype = (project.targets[index].blocks[
        definition.inputs.custom_block[1]
      ] = structuredClone(
        source.targets[index].blocks[definition.inputs.custom_block[1]]
      ))
      for (const [, parameterId] of Object.values(prototype.inputs)) {
        // Clone parameters
        if (parameterId)
          project.targets[index].blocks[parameterId] = structuredClone(
            source.targets[index].blocks[parameterId]
          )
      }
      if (definition.next) {
        hasBlock = true
        console.log(`🖋️ Rebuilding procedure ${procedureInfo.topBlockId}`)
        project.targets[index].blocks[definition.next] = {
          opcode: 'kylin_compile',
          next: null,
          parent: procedureInfo.topBlockId,
          inputs: {
            CODE: [
              1,
              [10, obfuscateCode(procedureInfo.cachedCompileResult.toString())]
            ]
          },
          fields: {},
          shadow: false,
          topLevel: false
        }
      }
    }
    if (!hasBlock) console.log('ℹ️ Nothing to do in this sprite')
    console.groupEnd()
  }
  if (Array.isArray(project.extensions)) {
    // keep original extensions
    for (const extension of project.extensions) {
      let opcode = null
      for (const target of source.targets) {
        for (const block of Object.values(target.blocks)) {
          if (
            typeof block === 'object' &&
            block !== null &&
            !Array.isArray(block) &&
            block.opcode.startsWith(`${extension}_`)
          ) {
            opcode = block.opcode
            break
          }
        }
        if (opcode !== null) {
          break
        }
      }
      if (opcode !== null) {
        console.log(`🔒 Adding extension '${extension}' as dependency`)
        // add an invisible block to keep the extension.
        project.targets[0].blocks[uid()] = {
          opcode,
          next: null,
          parent: null,
          inputs: {},
          fields: {},
          shadow: true,
          topLevel: true
        }
      } else {
        console.log(
          `❌ Failed to add extension '${extension}' as dependency: skipping`
        )
      }
    }
    project.extensions.push('kylin')
  }
  console.log('🔽 Injecting Kylin Runtime')
  if (
    typeof project.extensionURLs !== 'object' ||
    project.extensionURLs === null
  ) {
    project.extensionURLs = {}
  }
  project.extensionURLs['kylin'] = `data:text/javascript;base64,${btoa(
    Array.from(
      new TextEncoder().encode(
        `// You need to allow this extension to load unsandboxed in order to run the project.\n${
          UglifyJS.minify(
            `(${async function (
              Scratch,
              baseRuntime,
              runtimeFunctions,
              version
            ) {
              if (Scratch.extensions.unsandboxed === false) {
                throw new Error('Kylin Runtime needs to be loaded unsandboxed.')
              }
              Scratch.translate.setup({
                'zh-cn': {
                  'kylin.about': '关于 Kylin 编译器',
                  'kylin.compile': '(已编译)'
                },
                ja: {
                  'kylin.about': 'Kylin コンパイラーについて',
                  'kylin.compile': '(コンパイル済)'
                }
              })
              console.groupCollapsed(`🛠️ Kylin v${version}`)
              console.log('Kylin is based on Turbowarp compiler.')
              console.log(
                'Kylin compiler is distributed under the AGPL-3.0 license.'
              )
              console.log('Copyright (c) 2024 FurryR, inspired by VeroFess')
              console.groupEnd()
              const vm = Scratch.vm
              // { [spriteName]: { [procedureSignature]: generatorFunction } }
              const procedureCache = {}
              // From irgen
              // const generateProcedureVariant = (code, warp) => {
              //   if (warp) {
              //     return `W${code}`
              //   }
              //   return `Z${code}`
              // }
              // From jsexecute
              const insertRuntime = source => {
                let result = baseRuntime
                for (const functionName of Object.keys(runtimeFunctions)) {
                  if (source.includes(functionName)) {
                    result += `${runtimeFunctions[functionName]};`
                  }
                }
                result += `return ${source}`
                return result
              }
              // From jsexecute
              const globalState = {
                Cast: Scratch.Cast,
                log: {},
                thread: null
              }
              const kylinCompilerExecute = thread => {
                globalState.thread = thread
                const result = thread.kylin.next()
                if (
                  result.done &&
                  thread.status === thread.constructor.STATUS_RUNNING
                ) {
                  // Procedures do not retire thread automatically so we need to retire the thread manually for them.
                  thread.target.runtime.sequencer.retireThread(thread)
                }
              }
              function kylinCompileGenerator(code) {
                return new Function('globalState', insertRuntime(code))(
                  globalState
                )
              }
              function kylinCompileHat(code, thread) {
                return kylinCompileGenerator(code)(thread)
              }
              class Kylin {
                constructor() {
                  const Sequencer = vm.runtime.sequencer.constructor
                  const _stepThread = Sequencer.prototype.stepThread
                  Sequencer.prototype.stepThread = function (thread) {
                    if (thread.kylin) {
                      kylinCompilerExecute(thread)
                    } else {
                      _stepThread.call(this, thread)
                      if (
                        thread.kylin &&
                        thread.status === thread.constructor.STATUS_YIELD_TICK
                      ) {
                        thread.status = thread.constructor.STATUS_RUNNING
                        kylinCompilerExecute(thread)
                      }
                    }
                  }
                }
                getInfo() {
                  return {
                    id: 'kylin',
                    name: 'Kylin Runtime',
                    color1: '#00ffda',
                    blocks: [
                      {
                        blockType: Scratch.BlockType.LABEL,
                        text: `🛠️ Kylin v${version}`
                      },
                      {
                        blockType: Scratch.BlockType.BUTTON,
                        text: `🤖 ${Scratch.translate({
                          id: 'kylin.about',
                          default: 'About Kylin',
                          description: 'About'
                        })}`,
                        func: 'project'
                      },
                      {
                        blockType: Scratch.BlockType.COMMAND,
                        opcode: 'compile',
                        text: Scratch.translate({
                          id: 'kylin.compile',
                          default: '(Compiled)',
                          description: 'Precompile'
                        }),
                        hideFromPalette: true,
                        arguments: {
                          CODE: {
                            type: Scratch.ArgumentType.STRING,
                            defaultValue: ''
                          }
                        }
                      }
                    ]
                  }
                }
                project() {
                  const link = document.createElement('a')
                  link.href = 'https://github.com/FurryR/kylin-scratch'
                  link.target = '_blank'
                  link.click()
                }
                compile({ CODE }, util) {
                  const thread = util.thread
                  if (!globalState.Timer) {
                    class CompatibilityLayerBlockUtility extends util.constructor {
                      constructor() {
                        super()
                        this._startedBranch = null
                      }

                      get stackFrame() {
                        return this.thread.compatibilityStackFrame
                      }

                      startBranch(branchNumber, isLoop) {
                        this._startedBranch = [branchNumber, isLoop]
                      }

                      startProcedure() {
                        throw new Error(
                          'startProcedure is not supported by this BlockUtility'
                        )
                      }

                      // Parameters are not used by compiled scripts.
                      initParams() {
                        throw new Error(
                          'initParams is not supported by this BlockUtility'
                        )
                      }
                      pushParam() {
                        throw new Error(
                          'pushParam is not supported by this BlockUtility'
                        )
                      }
                      getParam() {
                        throw new Error(
                          'getParam is not supported by this BlockUtility'
                        )
                      }

                      init(thread, fakeBlockId, stackFrame) {
                        this.thread = thread
                        this.sequencer = thread.target.runtime.sequencer
                        this._startedBranch = null
                        thread.stack[0] = fakeBlockId
                        thread.compatibilityStackFrame = stackFrame
                      }
                    }
                    util.startStackTimer(0)
                    globalState.blockUtility =
                      new CompatibilityLayerBlockUtility()
                    globalState.Timer = util.stackFrame.timer.constructor
                    delete util.stackFrame.timer
                  }
                  const fn = kylinCompileHat(CODE, thread)
                  if (fn instanceof function* () {}.constructor) {
                    thread.kylin = fn()
                  } else {
                    thread.kylin = (function* () {
                      return fn()
                    })()
                  }
                  thread.procedures = new Proxy(
                    {},
                    {
                      get(_, procedureSignature) {
                        const realSignature = procedureSignature.substring(1)
                        if (
                          thread.target.sprite.name in procedureCache &&
                          realSignature in
                            procedureCache[thread.target.sprite.name]
                        ) {
                          return procedureCache[thread.target.sprite.name][
                            realSignature
                          ](thread)
                        }
                        // get prototype for finding procedure
                        const prototypes = Object.values(
                          thread.blockContainer._blocks
                        )
                          .filter(v => v.opcode === 'procedures_definition')
                          .map(
                            v =>
                              thread.blockContainer._blocks[
                                v.inputs.custom_block.block
                              ]
                          )
                        for (const prototype of prototypes) {
                          const rawSignature = prototype.mutation.proccode
                          if (realSignature === rawSignature) {
                            const definition =
                              thread.blockContainer._blocks[prototype.parent]
                            const compileCode = definition.next
                              ? thread.blockContainer._blocks[definition.next]
                              : null
                            if (
                              compileCode &&
                              compileCode.opcode === 'kylin_compile'
                            ) {
                              const codeBlock =
                                thread.blockContainer._blocks[
                                  compileCode.inputs.CODE.block
                                ]
                              if (codeBlock.opcode === 'text') {
                                const code = codeBlock.fields.TEXT.value
                                if (
                                  !(thread.target.sprite.name in procedureCache)
                                )
                                  procedureCache[thread.target.sprite.name] = {}
                                return (procedureCache[
                                  thread.target.sprite.name
                                ][realSignature] = kylinCompileGenerator(
                                  code,
                                  thread
                                ))(thread)
                              }
                            }
                            break
                          }
                        }
                        return Object.assign(
                          function () {
                            console.error(
                              `Kylin: Unknown procedure signature ${procedureSignature}`
                            )
                          },
                          { next: () => ({ done: true, value: undefined }) }
                        )
                      }
                    }
                  )
                  return util.yieldTick()
                }
              }
              Scratch.extensions.register(new Kylin())
            }.toString()})(Scratch, ${JSON.stringify(
              UglifyJS.minify(
                `
let stuckCounter = 0;
const isStuck = () => {
    // The real time is not checked on every call for performance.
    stuckCounter++;
    if (stuckCounter === 100) {
        stuckCounter = 0;
        return globalState.thread.target.runtime.sequencer.timer.timeElapsed() > 500;
    }
    return false;
};const isNotActuallyZero = val => {
    if (typeof val !== 'string') return false;
    for (let i = 0; i < val.length; i++) {
        const code = val.charCodeAt(i);
        if (code === 48 || code === 9) {
            return false;
        }
    }
    return true;
};const compareEqualSlow = (v1, v2) => {
    const n1 = +v1;
    if (isNaN(n1) || (n1 === 0 && isNotActuallyZero(v1))) return ('' + v1).toLowerCase() === ('' + v2).toLowerCase();
    const n2 = +v2;
    if (isNaN(n2) || (n2 === 0 && isNotActuallyZero(v2))) return ('' + v1).toLowerCase() === ('' + v2).toLowerCase();
    return n1 === n2;
};
const compareEqual = (v1, v2) => (typeof v1 === 'number' && typeof v2 === 'number' && !isNaN(v1) && !isNaN(v2) || v1 === v2) ? v1 === v2 : compareEqualSlow(v1, v2);const listIndexSlow = (index, length) => {
    if (index === 'last') {
        return length - 1;
    } else if (index === 'random' || index === 'any') {
        if (length > 0) {
            return (Math.random() * length) | 0;
        }
        return -1;
    }
    index = (+index || 0) | 0;
    if (index < 1 || index > length) {
        return -1;
    }
    return index - 1;
};
const listIndex = (index, length) => {
    if (typeof index !== 'number') {
      return listIndexSlow(index, length);
    }
    index = index | 0;
    return index < 1 || index > length ? -1 : index - 1;
};`
              ).code
            )}, ${JSON.stringify(
              Object.fromEntries(
                Object.entries(runtimeFunctions).map(([name, code]) => [
                  name,
                  UglifyJS.minify(code).code
                ])
              )
            )}, ${JSON.stringify(version)})`
          ).code
        }`
      )
    )
      .map(v => String.fromCodePoint(v))
      .join('')
  )}`
  console.groupEnd()
  console.log('🔽 Writing to the destination file.')
  await fs.writeFile(
    args.DEST,
    await zip.file('project.json', JSON.stringify(project)).generateAsync({
      compression: 'DEFLATE',
      compressionOptions: {
        level: 9
      },
      type: 'nodebuffer'
    })
  )
  console.log('✅ Done!')
})(parser.parse_args()).then(result => process.exit(result))
