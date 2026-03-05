import {
	bytesToHex,
	ConsensusAggregationByFields,
	type CronPayload,
	cre,
	getNetwork,
	type HTTPSendRequester,
	hexToBase64,
	median,
	Runner,
	type Runtime,
	TxStatus,
  } from '@chainlink/cre-sdk'
  import { encodeAbiParameters, parseUnits } from 'viem'
  import { z } from 'zod'
  
  const configSchema = z.object({
	schedule: z.string(),
	url: z.string(), // e.g. http://localhost:3000/balance
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
  
  interface BankResp {
	balance: number // e.g. 0, 100, 2000 (human units)
  }
  
  interface ReserveInfo {
	totalReserve: number
  }
  
  // Utility function to safely stringify objects with bigints
  const safeJsonStringify = (obj: any): string =>
	JSON.stringify(obj, (_, value) => (typeof value === 'bigint' ? value.toString() : value), 2)
  
  const fetchReserveInfo = (sendRequester: HTTPSendRequester, config: Config): ReserveInfo => {
	const response = sendRequester.sendRequest({ method: 'GET', url: config.url }).result()
  
	if (response.statusCode !== 200) {
	  throw new Error(`HTTP request failed with status: ${response.statusCode}`)
	}
  
	const responseText = Buffer.from(response.body).toString('utf-8')
	const data: BankResp = JSON.parse(responseText)
  
	if (typeof data.balance !== 'number' || Number.isNaN(data.balance)) {
	  throw new Error(`Invalid API response: expected { balance: number }, got: ${responseText}`)
	}
  
	return { totalReserve: data.balance }
  }
  
  const writeApiValueReport = (
	evmConfig: EVMConfig,
	runtime: Runtime<Config>,
	apiValueScaled: bigint,
  ): string => {
	const network = getNetwork({
	  chainFamily: 'evm',
	  chainSelectorName: evmConfig.chainName,
	  isTestnet: true,
	})
  
	if (!network) {
	  throw new Error(`Network not found for chain selector name: ${evmConfig.chainName}`)
	}
  
	const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
  
	runtime.log(`Writing apiValueScaled=${apiValueScaled.toString()} to ${evmConfig.chainName}`)
  
	// report payload = abi.encode(uint256 apiValueScaled)
	const reportData = encodeAbiParameters(
	  [{ name: 'apiValue', type: 'uint256' }],
	  [apiValueScaled],
	)
  
	const reportResponse = runtime
	  .report({
		encodedPayload: hexToBase64(reportData),
		encoderName: 'evm',
		signingAlgo: 'ecdsa',
		hashingAlgo: 'keccak256',
	  })
	  .result()
  
	const resp = evmClient
	  .writeReport(runtime, {
		receiver: evmConfig.receiverAddress,
		report: reportResponse,
		gasConfig: { gasLimit: evmConfig.gasLimit },
	  })
	  .result()
  
	if (resp.txStatus !== TxStatus.SUCCESS) {
	  throw new Error(`Failed to write report: ${resp.errorMessage || resp.txStatus}`)
	}
  
	const txHash = resp.txHash || new Uint8Array(32)
	runtime.log(`Write report txHash: ${bytesToHex(txHash)}`)
  
	return bytesToHex(txHash)
  }
  
  const doPOR = (runtime: Runtime<Config>): string => {
	runtime.log(`Fetching url ${runtime.config.url}`)
  
	const httpCapability = new cre.capabilities.HTTPClient()
	const reserveInfo = httpCapability
	  .sendRequest(
		runtime,
		fetchReserveInfo,
		ConsensusAggregationByFields<ReserveInfo>({
		  totalReserve: median,
		}),
	  )(runtime.config)
	  .result()
  
	runtime.log(`ReserveInfo ${safeJsonStringify(reserveInfo)}`)
  
	// API is human units (Bs). We scale to 18 decimals for onchain math.
	const apiValueScaled = parseUnits(reserveInfo.totalReserve.toString(), 18)
	runtime.log(`apiValueScaled ${apiValueScaled.toString()}`)
  
	for (const evmConfig of runtime.config.evms) {
	  writeApiValueReport(evmConfig, runtime, apiValueScaled)
	}
  
	return reserveInfo.totalReserve.toString()
  }
  
  const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
	if (!payload.scheduledExecutionTime) throw new Error('Scheduled execution time is required')
	runtime.log('Running CronTrigger')
	return doPOR(runtime)
  }
  
  const initWorkflow = (config: Config) => {
	const cronTrigger = new cre.capabilities.CronCapability()
	return [
	  cre.handler(
		cronTrigger.trigger({
		  schedule: config.schedule,
		}),
		onCronTrigger,
	  ),
	]
  }
  
  export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema })
	await runner.run(initWorkflow)
  }
  
  main()