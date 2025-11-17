import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { SocksProxyAgent } from 'socks-proxy-agent';

export class Socks5Http implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'HTTP over SOCKS5',
		name: 'socks5Http',
		icon: { light: 'file:httprequest.svg', dark: 'file:httprequest.dark.svg' },
		group: ['input'],
		version: 1,
		description: 'HTTP request using a SOCKS5 proxy',
		defaults: {
			name: 'HTTP over SOCKS5',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			// BASIC REQUEST CONFIG
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				placeholder: 'https://api.example.com/resource',
				required: true,
			},
			{
				displayName: 'Method',
				name: 'method',
				type: 'options',
				options: [
					{ name: 'DELETE', value: 'DELETE' },
					{ name: 'GET', value: 'GET' },
					{ name: 'HEAD', value: 'HEAD' },
					{ name: 'PATCH', value: 'PATCH' },
					{ name: 'POST', value: 'POST' },
					{ name: 'PUT', value: 'PUT' },
				],
				default: 'GET',
			},

			{
				displayName: 'Headers (JSON)',
				name: 'headersJson',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				placeholder: '{"Content-Type":"application/json"}',
				description: 'Raw JSON object with headers',
			},

			{
				displayName: 'Send Body',
				name: 'sendBody',
				type: 'boolean',
				default: false,
			},
			{
				displayName: 'Body (JSON)',
				name: 'bodyJson',
				type: 'string',
				typeOptions: {
					rows: 6,
				},
				default: '',
				placeholder: '{"foo":"bar"}',
				displayOptions: {
					show: {
						sendBody: [true],
					},
				},
				description: 'Raw JSON body (only used when Send Body is true)',
			},

			{
				displayName: 'Return Full Response',
				name: 'fullResponse',
				type: 'boolean',
				default: false,
				description:
					'Whether to return status, headers, etc. If disabled, only the parsed body is returned.',
			},

			// SOCKS5 PROXY CONFIG
			{
				displayName: 'SOCKS5 Proxy Host',
				name: 'proxyHost',
				type: 'string',
				default: '127.0.0.1',
				required: true,
			},
			{
				displayName: 'SOCKS5 Proxy Port',
				name: 'proxyPort',
				type: 'number',
				typeOptions: {
					minValue: 1,
					maxValue: 65535,
				},
				default: 9050,
				required: true,
			},
			{
				displayName: 'Use Proxy Authentication',
				name: 'useProxyAuth',
				type: 'boolean',
				default: false,
			},
			{
				displayName: 'Username',
				name: 'proxyUser',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						useProxyAuth: [true],
					},
				},
			},
			{
				displayName: 'Password',
				name: 'proxyPassword',
				type: 'string',
				typeOptions: {
					password: true,
				},
				default: '',
				displayOptions: {
					show: {
						useProxyAuth: [true],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnItems: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const url = this.getNodeParameter('url', i) as string;
				const method = this.getNodeParameter('method', i) as string;

				const headersJson = this.getNodeParameter('headersJson', i, '') as string;
				const sendBody = this.getNodeParameter('sendBody', i, false) as boolean;
				const bodyJson = this.getNodeParameter('bodyJson', i, '') as string;
				const fullResponse = this.getNodeParameter('fullResponse', i, false) as boolean;

				const proxyHost = this.getNodeParameter('proxyHost', i) as string;
				const proxyPort = this.getNodeParameter('proxyPort', i) as number;
				const useProxyAuth = this.getNodeParameter('useProxyAuth', i, false) as boolean;
				const proxyUser = this.getNodeParameter('proxyUser', i, '') as string;
				const proxyPassword = this.getNodeParameter('proxyPassword', i, '') as string;

				let headers: IDataObject | undefined;
				if (headersJson && headersJson.trim().length > 0) {
					try {
						headers = JSON.parse(headersJson) as IDataObject;
					} catch (err) {
						throw new NodeOperationError(this.getNode(), 'Invalid JSON in Headers field', {
							itemIndex: i,
						});
					}
				}

				let body: IDataObject | undefined;
				if (sendBody && bodyJson && bodyJson.trim().length > 0) {
					try {
						body = JSON.parse(bodyJson) as IDataObject;
					} catch (err) {
						throw new NodeOperationError(this.getNode(), 'Invalid JSON in Body field', {
							itemIndex: i,
						});
					}
				}

				// Build SOCKS5 URL
				let authPart = '';
				if (useProxyAuth && proxyUser) {
					const user = encodeURIComponent(proxyUser);
					const pass = encodeURIComponent(proxyPassword || '');
					authPart = `${user}:${pass}@`;
				}
				const socksUrl = `socks5://${authPart}${proxyHost}:${proxyPort}`;

				// Single agent per item. You could cache per combination if you want.
				const socksAgent = new SocksProxyAgent(socksUrl);

				const requestOptions: IHttpRequestOptions & {
					httpAgent?: any;
					httpsAgent?: any;
				} = {
					url,
					method,
					headers,
					json: true, // let n8n parse JSON if possible
					body,
					// Important: attach SOCKS5 agent so n8n's proxy handling does NOT override it
					httpAgent: socksAgent,
					httpsAgent: socksAgent,
				};

				const response = await this.helpers.httpRequest(requestOptions as IHttpRequestOptions);

				if (fullResponse) {
					// In fullResponse mode you might want status, headers, etc.
					// The helper already normalizes responses; if you need *really* raw,
					// you’d have to use axios directly, but this is usually enough.
					returnItems.push({
						json: response as IDataObject,
					});
				} else {
					// Assume response is JSON-ish; if string, wrap it
					let json: IDataObject;

					if (typeof response === 'string') {
						json = { data: response };
					} else {
						json = response as IDataObject;
					}

					returnItems.push({
						json,
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnItems.push({
						json: { error: (error as Error).message },
						pairedItem: i,
					});
					continue;
				}

				if ((error as any).context) {
					(error as any).context.itemIndex = i;
					throw error;
				}

				throw new NodeOperationError(this.getNode(), error as Error, {
					itemIndex: i,
				});
			}
		}

		return [returnItems];
	}
}
