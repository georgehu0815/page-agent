// import type { Context, SimpleStreamOptions, AssistantMessage } from "@mariozechner/pi-ai";
// import { AssistantMessageEventStream } from "@mariozechner/pi-ai/dist/utils/event-stream.js";
// import { AzureOpenAINativeClient, type Message, type Tool } from "./azure-openai-native-client.js";
// import { stripEnvelopeFromMessages } from "../gateway/chat-sanitize.js";

// /**
//  * Native Azure OpenAI stream adapter that bypasses LangChain
//  * to fix the empty tool arguments bug
//  */
// export function streamAzureOpenAINative(
//   context: Context,
//   options?: SimpleStreamOptions,
// ): AssistantMessageEventStream {
//   const eventStream = new AssistantMessageEventStream();

//   (async () => {
//     try {
//       // DEBUG: Log context to see what we're receiving
//       console.log("[Native Adapter] Context keys:", Object.keys(context));
//       console.log("[Native Adapter] Has systemPrompt?", !!context.systemPrompt);
//       console.log("[Native Adapter] Messages count:", context.messages?.length);

//       const client = new AzureOpenAINativeClient();

//       // Convert Pi context to Azure OpenAI messages
//       const messages: Message[] = [];

//       // Add system prompt if present
//       if (context.systemPrompt) {
//         console.log(
//           "[Native Adapter] Adding system prompt:",
//           context.systemPrompt.substring(0, 200),
//         );
//         messages.push({
//           role: "system",
//           content: context.systemPrompt,
//         });
//       } else {
//         console.log("[Native Adapter] WARNING: No system prompt found in context!");
//       }

//       // Convert context messages
//       for (const msg of context.messages) {
//         if (msg.role === "user") {
//           if (typeof msg.content === "string") {
//             messages.push({ role: "user", content: msg.content });
//           } else {
//             // Handle multimodal content (text + images)
//             const textParts = msg.content.filter((c) => c.type === "text");
//             const text = textParts.map((c) => (c.type === "text" ? c.text : "")).join("\n");
//             messages.push({ role: "user", content: text });
//           }
//         } else if (msg.role === "assistant") {
//           const textContent = msg.content
//             .filter((c) => c.type === "text")
//             .map((c) => (c.type === "text" ? c.text : ""))
//             .join("\n");

//           // Check if this assistant message has tool calls
//           const toolCalls = msg.content
//             .filter((c) => c.type === "toolCall")
//             .map((c) => ({
//               id: c.id,
//               type: "function" as const,
//               function: {
//                 name: c.name,
//                 arguments:
//                   typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments),
//               },
//             }));

//           messages.push({
//             role: "assistant",
//             content: textContent,
//             tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
//           });
//         } else if (msg.role === "toolResult") {
//           const textContent = msg.content
//             .filter((c) => c.type === "text")
//             .map((c) => (c.type === "text" ? c.text : ""))
//             .join("\n");

//           messages.push({
//             role: "tool",
//             content: textContent,
//             tool_call_id: msg.toolCallId,
//           });
//         }
//       }

//       // Sanitize messages to remove envelope headers and message_id hints
//       const sanitizedMessages = stripEnvelopeFromMessages(messages) as Message[];

//       // Convert Pi tools to Azure OpenAI format
//       const tools: Tool[] | undefined =
//         context.tools && context.tools.length > 0
//           ? context.tools.map((tool: any) => ({
//               type: "function" as const,
//               function: {
//                 name: tool.name,
//                 description: tool.description || "",
//                 parameters: tool.input_schema || tool.parameters || {},
//               },
//             }))
//           : undefined;

//       if (tools) {
//         console.log(`[Native Adapter] Binding ${tools.length} tools`);
//         console.log(
//           "[Native Adapter] Tool names:",
//           tools.map((t) => t.function.name),
//         );
//         // console.log(
//         //   "[Native Adapter] Full tool definitions:",
//         //   JSON.stringify(tools, null, 2),
//         // );
//       }

//       // Stream completion
//       const stream = client.streamChatCompletion({
//         messages: sanitizedMessages,
//         tools,
//         temperature: options?.temperature,
//         maxTokens: options?.maxTokens,
//       });

//       // Emit start event
//       eventStream.push({
//         type: "start" as const,
//         partial: {
//           role: "assistant" as const,
//           content: [],
//           api: "openai-completions" as const,
//           provider: "azureopenai",
//           model: "gpt-5.2",
//           usage: {
//             input: 0,
//             output: 0,
//             cacheRead: 0,
//             cacheWrite: 0,
//             totalTokens: 0,
//             cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
//           },
//           stopReason: "stop" as const,
//           timestamp: Date.now(),
//         },
//       });

//       let accumulatedText = "";
//       let contentIndex = 0;
//       const toolCalls: Array<{
//         type: "toolCall";
//         id: string;
//         name: string;
//         arguments: Record<string, any>;
//       }> = [];

//       // Map to accumulate tool call chunks
//       const toolCallsMap = new Map<
//         number,
//         {
//           id?: string;
//           name?: string;
//           arguments: string;
//         }
//       >();

//       for await (const chunk of stream) {
//         for (const choice of chunk.choices) {
//           const delta = choice.delta;

//           // DEBUG: Log what Azure OpenAI is returning
//           // if (delta.content || delta.tool_calls) {
//           //   console.log(
//           //     "[Native Adapter] Chunk delta:",
//           //     JSON.stringify({ content: delta.content, tool_calls: delta.tool_calls }, null, 2),
//           //   );
//           // }

//           // Handle text content
//           if (delta.content) {
//             const textDelta = delta.content;

//             // Emit text_start on first text
//             if (accumulatedText === "") {
//               eventStream.push({
//                 type: "text_start" as const,
//                 contentIndex,
//                 partial: {
//                   role: "assistant" as const,
//                   content: [{ type: "text" as const, text: "" }],
//                   api: "openai-completions" as const,
//                   provider: "azureopenai",
//                   model: "gpt-5.2",
//                   usage: {
//                     input: 0,
//                     output: 0,
//                     cacheRead: 0,
//                     cacheWrite: 0,
//                     totalTokens: 0,
//                     cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
//                   },
//                   stopReason: "stop" as const,
//                   timestamp: Date.now(),
//                 },
//               });
//             }

//             accumulatedText += textDelta;

//             // Emit text_delta
//             eventStream.push({
//               type: "text_delta" as const,
//               contentIndex,
//               delta: textDelta,
//               partial: {
//                 role: "assistant" as const,
//                 content: [{ type: "text" as const, text: accumulatedText }],
//                 api: "openai-completions" as const,
//                 provider: "azureopenai",
//                 model: "gpt-5.2",
//                 usage: {
//                   input: 0,
//                   output: 0,
//                   cacheRead: 0,
//                   cacheWrite: 0,
//                   totalTokens: 0,
//                   cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
//                 },
//                 stopReason: "stop" as const,
//                 timestamp: Date.now(),
//               },
//             });
//           }

//           // Handle tool calls (streaming chunks)
//           if (delta.tool_calls) {
//             for (const toolCallDelta of delta.tool_calls) {
//               const index = toolCallDelta.index;
//               let toolCallAccumulated = toolCallsMap.get(index);

//               if (!toolCallAccumulated) {
//                 toolCallAccumulated = {
//                   id: undefined,
//                   name: undefined,
//                   arguments: "",
//                 };
//                 toolCallsMap.set(index, toolCallAccumulated);
//               }

//               // Accumulate tool call data
//               if (toolCallDelta.id) {
//                 toolCallAccumulated.id = toolCallDelta.id;
//               }
//               if (toolCallDelta.function?.name) {
//                 toolCallAccumulated.name = toolCallDelta.function.name;
//               }
//               if (toolCallDelta.function?.arguments) {
//                 toolCallAccumulated.arguments += toolCallDelta.function.arguments;
//               }
//             }
//           }

//           // Handle finish_reason
//           if (choice.finish_reason === "tool_calls") {
//             // Emit tool calls
//             for (const [index, accumulated] of toolCallsMap.entries()) {
//               if (!accumulated.id || !accumulated.name) {
//                 console.warn(
//                   `[Native Adapter] Incomplete tool call at index ${index}:`,
//                   accumulated,
//                 );
//                 continue;
//               }

//               console.log(
//                 `[Native Adapter] Tool call complete:`,
//                 JSON.stringify(accumulated, null, 2),
//               );

//               // Parse arguments JSON string to object
//               let parsedArguments: Record<string, any>;
//               try {
//                 parsedArguments = JSON.parse(accumulated.arguments || "{}");
//               } catch (error) {
//                 console.error(
//                   "[Native Adapter] Failed to parse tool arguments:",
//                   accumulated.arguments,
//                   "Error:",
//                   error instanceof Error ? error.message : String(error),
//                 );
//                 parsedArguments = {};
//               }

//               const toolCallContent = {
//                 type: "toolCall" as const,
//                 id: accumulated.id,
//                 name: accumulated.name,
//                 arguments: parsedArguments,
//               };

//               toolCalls.push(toolCallContent);

//               const toolCallIndex = toolCalls.length - 1;

//               // Emit toolcall_start
//               eventStream.push({
//                 type: "toolcall_start" as const,
//                 contentIndex: toolCallIndex + (accumulatedText ? 1 : 0),
//                 partial: {
//                   role: "assistant" as const,
//                   content: accumulatedText
//                     ? [{ type: "text" as const, text: accumulatedText }, toolCallContent]
//                     : [toolCallContent],
//                   api: "openai-completions" as const,
//                   provider: "azureopenai",
//                   model: "gpt-5.2",
//                   usage: {
//                     input: 0,
//                     output: 0,
//                     cacheRead: 0,
//                     cacheWrite: 0,
//                     totalTokens: 0,
//                     cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
//                   },
//                   stopReason: "toolUse" as const,
//                   timestamp: Date.now(),
//                 },
//               });

//               // Emit toolcall_end
//               eventStream.push({
//                 type: "toolcall_end" as const,
//                 contentIndex: toolCallIndex + (accumulatedText ? 1 : 0),
//                 toolCall: toolCallContent,
//                 partial: {
//                   role: "assistant" as const,
//                   content: accumulatedText
//                     ? [{ type: "text" as const, text: accumulatedText }, toolCallContent]
//                     : [toolCallContent],
//                   api: "openai-completions" as const,
//                   provider: "azureopenai",
//                   model: "gpt-5.2",
//                   usage: {
//                     input: 0,
//                     output: 0,
//                     cacheRead: 0,
//                     cacheWrite: 0,
//                     totalTokens: 0,
//                     cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
//                   },
//                   stopReason: "toolUse" as const,
//                   timestamp: Date.now(),
//                 },
//               });
//             }
//           }
//         }
//       }

//       // Emit text_end if there was text
//       if (accumulatedText) {
//         eventStream.push({
//           type: "text_end" as const,
//           contentIndex: 0,
//           content: accumulatedText,
//           partial: {
//             role: "assistant" as const,
//             content: [{ type: "text" as const, text: accumulatedText }, ...toolCalls],
//             api: "openai-completions" as const,
//             provider: "azureopenai",
//             model: "gpt-5.2",
//             usage: {
//               input: 0,
//               output: 0,
//               cacheRead: 0,
//               cacheWrite: 0,
//               totalTokens: 0,
//               cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
//             },
//             stopReason: toolCalls.length > 0 ? ("toolUse" as const) : ("stop" as const),
//             timestamp: Date.now(),
//           },
//         });
//       }

//       // Build final content
//       const finalContent = [];
//       if (accumulatedText) {
//         finalContent.push({ type: "text" as const, text: accumulatedText });
//       }
//       finalContent.push(...toolCalls);

//       // Create final message
//       const finalMessage: AssistantMessage = {
//         role: "assistant" as const,
//         content: finalContent,
//         api: "openai-completions" as const,
//         provider: "azureopenai",
//         model: "gpt-5.2",
//         usage: {
//           input: 0,
//           output: 0,
//           cacheRead: 0,
//           cacheWrite: 0,
//           totalTokens: 0,
//           cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
//         },
//         stopReason: toolCalls.length > 0 ? ("toolUse" as const) : ("stop" as const),
//         timestamp: Date.now(),
//       };

//       // Emit done event
//       eventStream.push({
//         type: "done" as const,
//         reason: toolCalls.length > 0 ? ("toolUse" as const) : ("stop" as const),
//         message: finalMessage,
//       });

//       // End the stream
//       eventStream.end(finalMessage);
//     } catch (error) {
//       // Enhanced logging for rate limit errors
//       const errorText = error instanceof Error ? error.message : String(error);
//       if (errorText.includes("429") || errorText.includes("Rate Limit")) {
//         console.error("\n - azure-openai-stream-adapter-native.ts:439" + "=".repeat(80));
//         console.error(
//           "⚠️  AZURE OPENAI RATE LIMIT ERROR - azure-openai-stream-adapter-native.ts:440",
//         );
//         console.error("= - azure-openai-stream-adapter-native.ts:441".repeat(80));
//         console.error(
//           "[Native Adapter] Rate limit exceeded - azure-openai-stream-adapter-native.ts:442",
//         );
//         console.error(error);
//         console.error("= - azure-openai-stream-adapter-native.ts:444".repeat(80) + "\n");
//       } else {
//         console.error("[Native Adapter] Error: - azure-openai-stream-adapter-native.ts:446", error);
//       }
//       // On error, end with error message
//       const errorMessage: AssistantMessage = {
//         role: "assistant" as const,
//         content: [
//           {
//             type: "text" as const,
//             text: `Error: ${error instanceof Error ? error.message : String(error)}`,
//           },
//         ],
//         api: "openai-completions" as const,
//         provider: "azureopenai",
//         model: "gpt-5.2",
//         usage: {
//           input: 0,
//           output: 0,
//           cacheRead: 0,
//           cacheWrite: 0,
//           totalTokens: 0,
//           cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
//         },
//         stopReason: "error" as const,
//         errorMessage: error instanceof Error ? error.message : String(error),
//         timestamp: Date.now(),
//       };
//       eventStream.end(errorMessage);
//     }
//   })().catch((err) => {
//     // Catch any unhandled errors from the async IIFE to prevent process exit
//     console.error(
//       "[Native Adapter] Unhandled error in stream adapter: - azure-openai-stream-adapter-native.ts:476",
//       err,
//     );
//     console.error(
//       "[Native Adapter] Error stack: - azure-openai-stream-adapter-native.ts:477",
//       err instanceof Error ? err.stack : "No stack",
//     );
//     // Don't re-throw - the stream has already been ended above
//     // This prevents "ELIFECYCLE Command failed with exit code 1"
//   });

//   return eventStream;
// }
