// import { AzureCliCredential, ManagedIdentityCredential } from "@azure/identity";
// import {
//   AZURE_OPENAI_ENDPOINT,
//   AZURE_OPENAI_DEPLOYMENT,
//   AZURE_OPENAI_API_VERSION,
//   AZURE_OPENAI_SCOPE,
//   AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID,
// } from "./azure-openai-models.js";

// export type Message = {
//   role: "system" | "user" | "assistant" | "tool";
//   content: string;
//   tool_calls?: Array<{
//     id: string;
//     type: "function";
//     function: {
//       name: string;
//       arguments: string;
//     };
//   }>;
//   tool_call_id?: string;
//   name?: string;
// };

// export type Tool = {
//   type: "function";
//   function: {
//     name: string;
//     description: string;
//     parameters: any;
//   };
// };

// export type CompletionChunk = {
//   id: string;
//   choices: Array<{
//     index: number;
//     delta: {
//       role?: string;
//       content?: string;
//       tool_calls?: Array<{
//         index: number;
//         id?: string;
//         type?: "function";
//         function?: {
//           name?: string;
//           arguments?: string;
//         };
//       }>;
//     };
//     finish_reason?: string | null;
//   }>;
// };

// export class AzureOpenAINativeClient {
//   private credential: AzureCliCredential | ManagedIdentityCredential;
//   private token: string | null = null;
//   private tokenExpiry: number = 0;

//   constructor() {
//     if (process.env.NODE_ENV === "production") {
//       this.credential = new ManagedIdentityCredential(AZURE_OPENAI_MANAGED_IDENTITY_CLIENT_ID);
//       console.log(
//         "[Native Client] Using ManagedIdentityCredential",
//       );
//     } else {
//       this.credential = new AzureCliCredential();
//       console.log("[Native Client] Using AzureCliCredential - azure-openai-native-client.ts:68");
//     }
//   }

//   private async getToken(): Promise<string> {
//     // Refresh token if expired or not yet fetched
//     if (!this.token || Date.now() >= this.tokenExpiry) {
//       const tokenResponse = await this.credential.getToken(AZURE_OPENAI_SCOPE);
//       this.token = tokenResponse.token;
//       // Set expiry to 5 minutes before actual expiry for safety
//       this.tokenExpiry = tokenResponse.expiresOnTimestamp - 5 * 60 * 1000;
//       console.log("[Native Client] Token refreshed - azure-openai-native-client.ts:79");
//     }
//     return this.token;
//   }

//   async *streamChatCompletion(params: {
//     messages: Message[];
//     tools?: Tool[];
//     temperature?: number;
//     maxTokens?: number;
//   }): AsyncGenerator<CompletionChunk> {
//     const token = await this.getToken();

//     const url = `${AZURE_OPENAI_ENDPOINT}openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`;

//     const body: any = {
//       messages: params.messages,
//       stream: true,
//       temperature: params.temperature ?? 1,
//       max_tokens: params.maxTokens,
//     };

//     if (params.tools && params.tools.length > 0) {
//       body.tools = params.tools;
//       // Use "auto" to let model decide when to use tools
//       // This prevents forcing empty arguments when model is uncertain
//       body.tool_choice = "auto";
//     }

//     console.log("[Native Client] Calling Azure OpenAI API - azure-openai-native-client.ts:108");
//     console.log("[Native Client] URL: - azure-openai-native-client.ts:109", url);
//     console.log(
//       "[Native Client] Tools count:",
//       params.tools?.length ?? 0,
//     );
//     console.log(
//       "[Native Client] Messages being sent:",
//       JSON.stringify(params.messages, null, 2),
//     );
//     console.log(
//       "[Native Client] Request body:",
//       JSON.stringify(body, null, 2),
//     );

//     const response = await fetch(url, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: `Bearer ${token}`,
//         "api-key": token, // Azure OpenAI also accepts api-key header
//       },
//       body: JSON.stringify(body),
//     });

//     console.log(
//       `[Native Client] ✅ Azure OpenAI API responded  Status: ${response.status} ${response.statusText}`,
//     );

//     if (!response.ok) {
//       const errorText = await response.text();

//       // Enhanced error handling for rate limits (429)
//       if (response.status === 429) {
//         let retryAfter = "unknown";
//         let errorDetails = "";

//         try {
//           const errorJson = JSON.parse(errorText);
//           if (errorJson.error?.message) {
//             errorDetails = errorJson.error.message;
//             // Extract retry-after from error message if present
//             const retryMatch = errorDetails.match(/retry after (\d+) seconds?/i);
//             if (retryMatch) {
//               retryAfter = retryMatch[1] + "s";
//             }
//           }
//         } catch {
//           // If JSON parsing fails, use raw error text
//           errorDetails = errorText;
//         }

//         // Check Retry-After header
//         const retryAfterHeader = response.headers.get("Retry-After");
//         if (retryAfterHeader) {
//           retryAfter = retryAfterHeader + "s";
//         }

//         throw new Error(
//           `Azure OpenAI Rate Limit Exceeded (429)\n` +
//             `Deployment: ${AZURE_OPENAI_DEPLOYMENT}\n` +
//             `Endpoint: ${AZURE_OPENAI_ENDPOINT}\n` +
//             `Retry After: ${retryAfter}\n` +
//             `Details: ${errorDetails}\n` +
//             `Tip: Reduce request frequency or upgrade quota at https://aka.ms/oai/quotaincrease`,
//         );
//       }

//       // Handle other errors (400, 401, 403, 500, etc.)
//       console.error(
//         `\n[Native Client] ❌ Azure OpenAI API Error: ${response.status} ${response.statusText}`,
//       );
//       console.error(
//         `[Native Client] Error response:`,
//         errorText,
//       );

//       // Try to parse JSON error for better diagnostics
//       let errorDetails = errorText;
//       try {
//         const errorJson = JSON.parse(errorText);
//         if (errorJson.error) {
//           errorDetails = JSON.stringify(errorJson.error, null, 2);
//           console.error(
//             `[Native Client] Parsed error details:`,
//             errorDetails,
//           );
//         }
//       } catch {
//         // Not JSON, use raw text
//       }

//       throw new Error(
//         `Azure OpenAI API error: ${response.status} ${response.statusText}\n${errorDetails}`,
//       );
//     }

//     if (!response.body) {
//       throw new Error("Response body is null");
//     }

//     const reader = response.body.getReader();
//     const decoder = new TextDecoder();
//     let buffer = "";
//     const streamStartTime = Date.now();
//     let chunkCount = 0;

//     console.log(
//       "[Native Client] 🔄 Starting to stream response...",
//     );

//     try {
//       while (true) {
//         const { done, value } = await reader.read();

//         if (done) {
//           break;
//         }

//         buffer += decoder.decode(value, { stream: true });

//         // Process complete lines
//         const lines = buffer.split("\n");
//         buffer = lines.pop() || "";

//         for (const line of lines) {
//           const trimmed = line.trim();
//           if (!trimmed || trimmed === "data: [DONE]") {
//             continue;
//           }

//           if (trimmed.startsWith("data: ")) {
//             try {
//               const jsonStr = trimmed.slice(6); // Remove "data: " prefix
//               const chunk: CompletionChunk = JSON.parse(jsonStr);
//               chunkCount++;
//               yield chunk;
//             } catch (error) {
//               console.error(
//                 "[Native Client] Failed to parse chunk:",
//                 trimmed,
//                 error,
//               );
//             }
//           }
//         }
//       }
//     } finally {
//       const streamDuration = Date.now() - streamStartTime;
//       console.log(
//         `[Native Client] ✅ Streaming complete - Chunks: ${chunkCount}, Duration: ${streamDuration}ms`,
//       );
//       reader.releaseLock();
//     }
//   }
// }
