import CodeEditor from '@/components/CodeEditor'
import { Heading } from '@/components/Heading'
import { CDN_DEMO_CN_URL, CDN_DEMO_URL } from '@/constants'
import { useLanguage } from '@/i18n/context'

export default function QuickStart() {
	const { isZh } = useLanguage()

	return (
		<div>
			<h1 className="text-4xl font-bold mb-6">Quick Start</h1>

			<p className=" mb-6 leading-relaxed">
				{isZh ? '几分钟内完成 page-agent 的集成。' : 'Integrate page-agent in minutes.'}
			</p>

			<Heading id="installation-steps" className="text-2xl font-bold mb-3">
				{isZh ? '安装步骤' : 'Installation Steps'}
			</Heading>

			<div className="space-y-4 mb-6">
				{/* Demo CDN - One Line */}
				<div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
					<h3 className="text-lg font-semibold mb-2 text-blue-900 dark:text-blue-300">
						{isZh ? '🚀 快速体验（Demo CDN）' : '🚀 Quick Try (Demo CDN)'}
					</h3>
					<div className="bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded mb-3 text-sm">
						<span className="text-yellow-800 dark:text-yellow-200">
							⚠️{' '}
							{isZh ? (
								<>
									该 Demo CDN 使用了免费的测试 LLM API，使用即表示您同意其
									<a
										href="https://github.com/alibaba/page-agent/blob/main/docs/terms-and-privacy.md#2-testing-api-and-demo-disclaimer--terms-of-use"
										target="_blank"
										rel="noopener noreferrer"
										className="underline"
									>
										使用条款
									</a>
								</>
							) : (
								<>
									This demo CDN uses our free testing LLM API. By using it you agree to the{' '}
									<a
										href="https://github.com/alibaba/page-agent/blob/main/docs/terms-and-privacy.md#2-testing-api-and-demo-disclaimer--terms-of-use"
										target="_blank"
										rel="noopener noreferrer"
										className="underline"
									>
										Terms of Use
									</a>
								</>
							)}
						</span>
					</div>
					<CodeEditor
						code={`<script src="DEMO_CDN_URL" crossorigin="true"></script>`}
						language="html"
					/>
					<table className="w-full border-collapse text-sm">
						<thead>
							<tr className="border-b border-gray-200 dark:border-gray-700">
								<th className="text-left py-2 px-3 font-semibold w-28">
									{isZh ? '镜像' : 'Mirrors'}
								</th>
								<th className="text-left py-2 px-3 font-semibold">URL</th>
							</tr>
						</thead>
						<tbody>
							<tr className="border-b border-gray-100 dark:border-gray-800">
								<td className="py-2 px-3">{isZh ? '全球' : 'Global'}</td>
								<td className="py-2 px-3 font-mono text-xs break-all">{CDN_DEMO_URL}</td>
							</tr>
							<tr>
								<td className="py-2 px-3">{isZh ? '中国' : 'China'}</td>
								<td className="py-2 px-3 font-mono text-xs break-all">{CDN_DEMO_CN_URL}</td>
							</tr>
						</tbody>
					</table>
				</div>

				{/* NPM - Recommended */}
				<div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
					<h3 className="text-lg font-semibold mb-2 text-green-900 dark:text-green-300">
						{isZh ? '📦 NPM 安装（推荐）' : '📦 NPM Install (Recommended)'}
					</h3>
					<CodeEditor
						code={`// npm install page-agent

import { PageAgent } from 'page-agent'`}
						language="bash"
					/>
				</div>

				<div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
					<h3 className="text-lg font-semibold mb-2 text-purple-900 dark:text-purple-300">
						{isZh ? '2. 初始化配置' : '2. Initialize Configuration'}
					</h3>

					{/* Azure OpenAI — default */}
					<div className="mb-4">
						<p className="text-sm font-semibold mb-1 text-purple-800 dark:text-purple-300">
							{isZh
								? '✅ 推荐：Azure OpenAI + 托管身份（无需 API Key）'
								: '✅ Recommended: Azure OpenAI with Managed Identity (no API key needed)'}
						</p>
						<div className="bg-blue-50 dark:bg-blue-900/20 p-2 rounded mb-2 text-sm text-blue-800 dark:text-blue-200">
							{isZh ? (
								<>
									本地开发前请先运行{' '}
									<code className="font-mono bg-blue-100 dark:bg-blue-800 px-1 rounded">
										az login
									</code>{' '}
									完成 Azure CLI 认证。生产环境自动使用托管身份，无需额外配置。
								</>
							) : (
								<>
									For local dev, run{' '}
									<code className="font-mono bg-blue-100 dark:bg-blue-800 px-1 rounded">
										az login
									</code>{' '}
									once to authenticate. In production, Managed Identity is used automatically.
								</>
							)}
						</div>
						<CodeEditor
							code={`// ${isZh ? '无需 baseURL / apiKey / model — 自动使用 Azure OpenAI 托管身份认证' : 'No baseURL / apiKey / model needed — Azure Managed Identity is used automatically'}
const agent = new PageAgent({
  language: '${isZh ? 'zh-CN' : 'en-US'}'
})`}
							language="javascript"
						/>
					</div>

					{/* Divider */}
					<div className="flex items-center gap-2 my-3">
						<div className="flex-1 h-px bg-purple-200 dark:bg-purple-700" />
						<span className="text-xs text-purple-500 dark:text-purple-400">
							{isZh ? '或使用其他 LLM 提供商' : 'or use another LLM provider'}
						</span>
						<div className="flex-1 h-px bg-purple-200 dark:bg-purple-700" />
					</div>

					{/* OpenAI-compatible fallback */}
					<div>
						<p className="text-sm font-semibold mb-1 text-purple-800 dark:text-purple-300">
							{isZh
								? 'OpenAI 兼容接口（提供 baseURL + apiKey + model 即可切换）'
								: 'OpenAI-compatible endpoint (provide baseURL + apiKey + model to switch)'}
						</p>
						<CodeEditor
							code={`const agent = new PageAgent({
  baseURL: 'https://api.openai.com/v1',
  apiKey: 'YOUR_API_KEY',
  model: 'gpt-4o',
  language: '${isZh ? 'zh-CN' : 'en-US'}'
})`}
							language="javascript"
						/>
					</div>
				</div>

				<div className="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
					<h3 className="text-lg font-semibold mb-2 text-orange-900 dark:text-orange-300">
						{isZh ? '3. 开始使用' : '3. Start Using'}
					</h3>
					<CodeEditor
						code={`// ${isZh ? '程序化执行自然语言指令' : 'Execute natural language instructions programmatically'}
await agent.execute('${isZh ? '点击提交按钮，然后填写用户名为张三' : 'Click submit button, then fill username as John'}');

// ${isZh ? '或者' : 'Or:'}
// ${isZh ? '显示对话框让用户输入指令' : 'Show panel for user to input instructions'}
agent.panel.show()
`}
						language="javascript"
					/>
				</div>
			</div>
		</div>
	)
}
