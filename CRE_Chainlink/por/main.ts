import {
	bytesToHex,
	type CronPayload,
	cre,
	getNetwork,
	hexToBase64,
	Runner,
	type Runtime,
	TxStatus,
  } from '@chainlink/cre-sdk'
  import { encodeAbiParameters, parseUnits } from 'viem'
  import { z } from 'zod'
  
  const configSchema = z.object({
	schedule: z.string(),
	url: z.string(), // http://localhost:3000/batch
	evms: z.array(
	  z.object({
		receiverAddress: z.string(),
		chainName: z.string(),
		gasLimit: z.string(),
	  }),
	),
  })
  
  type Config = z.infer<typeof configSchema>
  type EVMConfig = z.infer<typeof configSchema.shape.evms.element>
  
  type ApiResp = {
	bankBalance: number
	approvedIds: number[]
  }
  
  const safeJson = (obj: unknown): string =>
	JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2)
  
  // 👇 runtimeAny: evita el mismatch NodeRuntime vs Runtime<Config> en typings
  function readBatchFromApi(runtimeAny: any): ApiResp {
	const http = new cre.capabilities.HTTPClient()
	const res = http
	  .sendRequest(runtimeAny, {
		method: 'GET',
		url: runtimeAny.config.url,
	  })
	  .result()
  
	if (res.statusCode !== 200) {
	  const body = Buffer.from(res.body).toString('utf-8')
	  throw new Error(`HTTP ${res.statusCode}: ${body}`)
	}
  
	const txt = Buffer.from(res.body).toString('utf-8')
	const data = JSON.parse(txt) as ApiResp
  
	if (!Number.isInteger(data.bankBalance) || data.bankBalance < 0) {
	  throw new Error(`Invalid bankBalance (int >= 0). Got: ${txt}`)
	}
	if (!Array.isArray(data.approvedIds) || !data.approvedIds.every((n) => Number.isInteger(n) && n >= 0)) {
	  throw new Error(`Invalid approvedIds (int[] >= 0). Got: ${txt}`)
	}
  
	return data
  }
  
  function writeReport(
	evm: EVMConfig,
	runtime: Runtime<Config>,
	bankBalanceScaled: bigint,
	approvedIds: bigint[],
  ): void {
	const network = getNetwork({
	  chainFamily: 'evm',
	  chainSelectorName: evm.chainName,
	  isTestnet: true,
	})
	if (!network) throw new Error(`Network not found: ${evm.chainName}`)
  
	const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
  
	const payload = encodeAbiParameters(
	  [
		{ name: 'bankBalanceScaled', type: 'uint256' },
		{ name: 'approvedIds', type: 'uint256[]' },
	  ],
	  [bankBalanceScaled, approvedIds],
	)
  
	const report = runtime
	  .report({
		encodedPayload: hexToBase64(payload),
		encoderName: 'evm',
		signingAlgo: 'ecdsa',
		hashingAlgo: 'keccak256',
	  })
	  .result()
  
	const resp = evmClient
	  .writeReport(runtime, {
		receiver: evm.receiverAddress,
		report,
		gasConfig: { gasLimit: evm.gasLimit },
	  })
	  .result()
  
	if (resp.txStatus !== TxStatus.SUCCESS) {
	  throw new Error(`writeReport failed: ${resp.errorMessage || resp.txStatus}`)
	}
  
	runtime.log(`Write report txHash: ${bytesToHex(resp.txHash || new Uint8Array(32))}`)
  }
  
  function doWork(runtime: Runtime<Config>): string {
	runtime.log(`Fetching url ${runtime.config.url}`)
  
	// runtime as any solo en esta línea para el HTTPClient typing
	const data = readBatchFromApi(runtime as any)
  
	const bankBalanceScaled = parseUnits(data.bankBalance.toString(), 18)
	const ids = data.approvedIds.map((n) => BigInt(n))
  
	runtime.log(
	  `Batch ${safeJson({ bankBalance: data.bankBalance, bankBalanceScaled, approvedIds: data.approvedIds })}`,
	)
  
	for (const evm of runtime.config.evms) {
	  writeReport(evm, runtime, bankBalanceScaled, ids)
	}
  
	return `${data.bankBalance}:${data.approvedIds.length}`
  }
  
  function onCron(runtime: Runtime<Config>, payload: CronPayload): string {
	if (!payload.scheduledExecutionTime) throw new Error('Scheduled execution time required')
	runtime.log('Running CronTrigger')
	return doWork(runtime)
  }
  
  const initWorkflow = (config: Config) => {
	const cron = new cre.capabilities.CronCapability()
	return [cre.handler(cron.trigger({ schedule: config.schedule }), onCron)]
  }
  
  export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema })
	await runner.run(initWorkflow)
  }
  
  main()