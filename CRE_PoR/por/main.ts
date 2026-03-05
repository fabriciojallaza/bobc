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
	url: z.string(),
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
  
  interface PORResponse {
	accountName: string
	totalTrust: number
	totalToken: number
	ripcord: boolean
	updatedAt: string
  }
  
  interface ReserveInfo {
	totalReserve: number
  }
  
  const safeJsonStringify = (obj: any): string =>
	JSON.stringify(obj, (_, value) => (typeof value === 'bigint' ? value.toString() : value), 2)
  
  const fetchReserveInfo = (sendRequester: HTTPSendRequester, config: Config): ReserveInfo => {
	const response = sendRequester.sendRequest({ method: 'GET', url: config.url }).result()
  
	if (response.statusCode !== 200) {
	  throw new Error(`HTTP request failed with status: ${response.statusCode}`)
	}
  
	const responseText = Buffer.from(response.body).toString('utf-8')
	const porResp: PORResponse = JSON.parse(responseText)
  
	if (porResp.ripcord) {
	  throw new Error('ripcord is true')
	}
  
	return {
	  totalReserve: porResp.totalToken,
	}
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
  
	// Report payload that your receiver will decode with: abi.decode(report, (uint256))
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
  
	// IMPORTANT: this assumes API returns "human" units and you want 18 decimals onchain
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