import type {
  IBinaryData,
  IExecuteFunctions,
  IDataObject,
  IHttpRequestMethods,
  IHttpRequestOptions,
  ILoadOptionsFunctions,
  IN8nHttpFullResponse,
  INodeExecutionData,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
  ISupplyDataFunctions,
  SupplyData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { Embeddings } from '@langchain/core/embeddings';
import type { BaseChatModelCallOptions } from '@langchain/core/language_models/chat_models';
import { SimpleChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';

type JsonObject = IDataObject;
type RequestContext = IExecuteFunctions | ILoadOptionsFunctions | ISupplyDataFunctions;

type Credentials = {
  baseUrl?: string;
  apiVersion?: string;
};

class GeminiAiStudioChatModel extends SimpleChatModel<BaseChatModelCallOptions> {
  private readonly context: ISupplyDataFunctions;
  private readonly baseURL: string;
  private readonly model: string;
  private readonly systemInstruction: string;
  private readonly generateOptions: JsonObject;

  constructor(fields: {
    context: ISupplyDataFunctions;
    baseURL: string;
    model: string;
    systemInstruction: string;
    generateOptions: JsonObject;
  }) {
    super({});
    this.context = fields.context;
    this.baseURL = fields.baseURL;
    this.model = fields.model;
    this.systemInstruction = fields.systemInstruction;
    this.generateOptions = fields.generateOptions;
  }

  _llmType(): string {
    return 'gemini-ai-studio';
  }

  async _call(messages: BaseMessage[], options: this['ParsedCallOptions']): Promise<string> {
    const body: JsonObject = {
      contents: messagesToGeminiContents(messages),
    };

    const systemInstruction = this.systemInstruction.trim();
    if (systemInstruction) {
      body.system_instruction = { parts: [{ text: systemInstruction }] };
    }

    applyGenerateOptions(body, this.generateOptions);
    if (Array.isArray(options.stop) && options.stop.length > 0) {
      const generationConfig = (isJsonObject(body.generationConfig) ? body.generationConfig : {}) as JsonObject;
      generationConfig.stopSequences = options.stop;
      body.generationConfig = generationConfig;
    }

    const response = await geminiRequest.call(
      this.context,
      'POST',
      `/${modelPath(this.model)}:generateContent`,
      this.baseURL,
      body,
    );

    return extractCandidateTexts(response)[0] ?? '';
  }
}

class GeminiAiStudioEmbeddings extends Embeddings {
  private readonly context: ISupplyDataFunctions;
  private readonly baseURL: string;
  private readonly model: string;
  private readonly options: JsonObject;

  constructor(fields: {
    context: ISupplyDataFunctions;
    baseURL: string;
    model: string;
    options: JsonObject;
  }) {
    super({});
    this.context = fields.context;
    this.baseURL = fields.baseURL;
    this.model = fields.model;
    this.options = fields.options;
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    if (documents.length === 0) {
      return [];
    }

    const body = buildBatchEmbeddingRequest(documents, this.model, this.options);
    const response = await geminiRequest.call(
      this.context,
      'POST',
      `/${modelPath(this.model)}:batchEmbedContents`,
      this.baseURL,
      body,
    );

    return extractEmbeddings(response);
  }

  async embedQuery(document: string): Promise<number[]> {
    const body: JsonObject = {
      model: toModelResource(this.model),
      content: {
        parts: [{ text: document }],
      },
    };

    assignIfPresent(body, 'taskType', this.options.taskType);
    assignIfPresent(body, 'title', this.options.title);

    if (typeof this.options.outputDimensionality === 'number' && this.options.outputDimensionality > 0) {
      body.output_dimensionality = this.options.outputDimensionality;
    }

    const response = await geminiRequest.call(
      this.context,
      'POST',
      `/${modelPath(this.model)}:embedContent`,
      this.baseURL,
      body,
    );

    return extractEmbeddingValues(response.embedding);
  }
}

export class GeminiAiStudio implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Gemini AI Studio',
    name: 'geminiAiStudio',
    icon: 'file:geminiAiStudio.svg',
    group: ['transform'],
    version: [1],
    subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
    description: 'Use the Google Gemini API through direct AI Studio REST calls',
    defaults: { name: 'Gemini AI Studio' },
    inputs: ['main'],
    outputs: [
      NodeConnectionTypes.Main,
      {
        type: NodeConnectionTypes.AiLanguageModel,
        displayName: 'Language Model',
      },
      {
        type: NodeConnectionTypes.AiEmbedding,
        displayName: 'Embeddings',
      },
    ],
    outputNames: ['Main', 'Language Model', 'Embeddings'],
    credentials: [{ name: 'googleGenerativeAiApi', required: true }],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        default: 'content',
        options: [
          { name: 'Content', value: 'content' },
          { name: 'Cached Content', value: 'cachedContent' },
          { name: 'Embedding', value: 'embedding' },
          { name: 'File', value: 'file' },
          { name: 'Model', value: 'model' },
          { name: 'Token', value: 'token' },
        ],
      },

      // Content
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'generate',
        displayOptions: { show: { resource: ['content'] } },
        options: [
          {
            name: 'Generate Content',
            value: 'generate',
            action: 'Generate content with a Gemini model',
          },
          {
            name: 'Stream Generate Content',
            value: 'stream',
            action: 'Stream generated content with a Gemini model',
          },
        ],
      },
      {
        displayName: 'Model',
        name: 'model',
        type: 'options',
        default: 'gemini-flash-latest',
        required: true,
        placeholder: 'gemini-flash-latest',
        description: 'Model ID or resource name, for example gemini-3-flash-preview or models/gemini-flash-latest',
        typeOptions: { loadOptionsMethod: 'getModels' },
        allowArbitraryValues: true,
        displayOptions: { show: { resource: ['content'], operation: ['generate', 'stream'] } },
      },
      {
        displayName: 'Input Mode',
        name: 'contentInputMode',
        type: 'options',
        default: 'simple',
        displayOptions: { show: { resource: ['content'], operation: ['generate', 'stream'] } },
        options: [
          { name: 'Simple Text', value: 'simple' },
          { name: 'Contents JSON', value: 'contentsJson' },
          { name: 'Raw Request JSON', value: 'rawJson' },
        ],
      },
      {
        displayName: 'Prompt',
        name: 'prompt',
        type: 'string',
        typeOptions: { rows: 5 },
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['content'], operation: ['generate', 'stream'], contentInputMode: ['simple'] },
        },
      },
      {
        displayName: 'Multimodal Parts',
        name: 'multimodalParts',
        type: 'fixedCollection',
        placeholder: 'Add Part',
        default: {},
        description: 'Append binary inlineData or uploaded fileData parts to the simple prompt',
        typeOptions: { multipleValues: true },
        displayOptions: {
          show: { resource: ['content'], operation: ['generate', 'stream'], contentInputMode: ['simple'] },
        },
        options: [
          {
            displayName: 'Binary Data',
            name: 'binaryParts',
            values: [
              {
                displayName: 'Binary Property',
                name: 'binaryPropertyName',
                type: 'string',
                default: 'data',
                required: true,
                description: 'Name of the input binary property to send as inlineData',
              },
              {
                displayName: 'MIME Type',
                name: 'mimeType',
                type: 'string',
                default: '',
                placeholder: 'image/png',
                description: 'Override the binary MIME type. By default the input binary MIME type is used.',
              },
            ],
          },
          {
            displayName: 'File Data',
            name: 'fileDataParts',
            values: [
              {
                displayName: 'File URI',
                name: 'fileUri',
                type: 'string',
                default: '',
                required: true,
                placeholder: 'https://generativelanguage.googleapis.com/v1beta/files/abc123',
                description: 'Gemini Files API URI to send as fileData',
              },
              {
                displayName: 'MIME Type',
                name: 'mimeType',
                type: 'string',
                default: '',
                required: true,
                placeholder: 'application/pdf',
              },
            ],
          },
        ],
      },
      {
        displayName: 'Contents (JSON)',
        name: 'contentsJson',
        type: 'json',
        default: '[{"parts":[{"text":"Explain how AI works in a few words"}]}]',
        required: true,
        description: 'Gemini contents array. Supports text, inlineData, fileData, and roles.',
        displayOptions: {
          show: {
            resource: ['content'],
            operation: ['generate', 'stream'],
            contentInputMode: ['contentsJson'],
          },
        },
      },
      {
        displayName: 'Raw Request Body (JSON)',
        name: 'rawGenerateRequestJson',
        type: 'json',
        default: '{\n  "contents": [\n    {\n      "parts": [\n        {\n          "text": "Explain how AI works in a few words"\n        }\n      ]\n    }\n  ]\n}',
        required: true,
        description: 'Complete request body sent to :generateContent. Use this for fields not exposed by the node.',
        displayOptions: {
          show: { resource: ['content'], operation: ['generate', 'stream'], contentInputMode: ['rawJson'] },
        },
      },
      {
        displayName: 'System Instruction',
        name: 'systemInstruction',
        type: 'string',
        typeOptions: { rows: 3 },
        default: '',
        description: 'Optional system instruction sent as system_instruction.parts[0].text',
        displayOptions: {
          show: {
            resource: ['content'],
            operation: ['generate', 'stream'],
            contentInputMode: ['simple', 'contentsJson'],
          },
        },
      },
      {
        displayName: 'Options',
        name: 'generateOptions',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        displayOptions: { show: { resource: ['content'], operation: ['generate', 'stream'] } },
        options: [
          {
            displayName: 'Cached Content',
            name: 'cachedContent',
            type: 'string',
            default: '',
            placeholder: 'cachedContents/abc123',
            description: 'Cached content resource name to use for generation',
          },
          {
            displayName: 'Candidate Count',
            name: 'candidateCount',
            type: 'number',
            default: 1,
            typeOptions: { minValue: 1 },
          },
          {
            displayName: 'Frequency Penalty',
            name: 'frequencyPenalty',
            type: 'number',
            default: 0,
          },
          {
            displayName: 'Generation Config (JSON)',
            name: 'generationConfig',
            type: 'json',
            default: '',
            description: 'Raw generationConfig object. Specific fields below override matching keys.',
          },
          {
            displayName: 'Function Declarations',
            name: 'functionDeclarations',
            type: 'fixedCollection',
            default: {},
            placeholder: 'Add Function',
            typeOptions: { multipleValues: true },
            options: [
              {
                displayName: 'Function',
                name: 'functionDeclaration',
                values: [
                  {
                    displayName: 'Name',
                    name: 'name',
                    type: 'string',
                    default: '',
                    required: true,
                    description: 'Function name exposed to Gemini',
                  },
                  {
                    displayName: 'Description',
                    name: 'description',
                    type: 'string',
                    typeOptions: { rows: 2 },
                    default: '',
                  },
                  {
                    displayName: 'Parameters Schema (JSON)',
                    name: 'parametersJson',
                    type: 'json',
                    default: '',
                    description: 'Optional JSON schema object for function parameters',
                  },
                ],
              },
            ],
          },
          {
            displayName: 'Max Output Tokens',
            name: 'maxOutputTokens',
            type: 'number',
            default: 1024,
            typeOptions: { minValue: 1 },
          },
          {
            displayName: 'Presence Penalty',
            name: 'presencePenalty',
            type: 'number',
            default: 0,
          },
          {
            displayName: 'Response MIME Type',
            name: 'responseMimeType',
            type: 'string',
            default: '',
            placeholder: 'application/json',
          },
          {
            displayName: 'Response Schema (JSON)',
            name: 'responseSchema',
            type: 'json',
            default: '',
            description: 'JSON schema for structured output. Usually used with Response MIME Type application/json.',
          },
          {
            displayName: 'Safety Settings (JSON)',
            name: 'safetySettings',
            type: 'json',
            default: '',
            description: 'Array of Gemini safetySetting objects',
          },
          {
            displayName: 'Seed',
            name: 'seed',
            type: 'number',
            default: 0,
          },
          {
            displayName: 'Stop Sequences',
            name: 'stopSequences',
            type: 'string',
            default: '',
            description: 'One stop sequence per line',
          },
          {
            displayName: 'Temperature',
            name: 'temperature',
            type: 'number',
            default: 1,
            typeOptions: { minValue: 0 },
          },
          {
            displayName: 'Thinking Budget',
            name: 'thinkingBudget',
            type: 'number',
            default: 0,
            description: 'Optional thinking token budget. 0 means omitted. If set, Thinking Level is omitted.',
          },
          {
            displayName: 'Thinking Level',
            name: 'thinkingLevel',
            type: 'options',
            default: '',
            description: 'Optional thinking level. Omitted unless explicitly selected.',
            options: [
              { name: 'Omit', value: '' },
              { name: 'Low', value: 'low' },
              { name: 'Medium', value: 'medium' },
              { name: 'High', value: 'high' },
            ],
          },
          {
            displayName: 'Tool Config (JSON)',
            name: 'toolConfig',
            type: 'json',
            default: '',
            description: 'Gemini toolConfig object',
          },
          {
            displayName: 'Tools (JSON)',
            name: 'tools',
            type: 'json',
            default: '',
            description: 'Array of Gemini tool declarations, such as Google Search, code execution, or function declarations',
          },
          {
            displayName: 'Top K',
            name: 'topK',
            type: 'number',
            default: 40,
            typeOptions: { minValue: 1 },
          },
          {
            displayName: 'Top P',
            name: 'topP',
            type: 'number',
            default: 0.95,
            typeOptions: { minValue: 0, maxValue: 1 },
          },
        ],
      },

      // File
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'upload',
        displayOptions: { show: { resource: ['file'] } },
        options: [
          { name: 'Upload', value: 'upload', action: 'Upload a file to Gemini' },
          { name: 'Get', value: 'get', action: 'Get a Gemini file' },
          { name: 'List', value: 'list', action: 'List Gemini files' },
          { name: 'Delete', value: 'delete', action: 'Delete a Gemini file' },
        ],
      },
      {
        displayName: 'Binary Property',
        name: 'fileBinaryPropertyName',
        type: 'string',
        default: 'data',
        required: true,
        displayOptions: { show: { resource: ['file'], operation: ['upload'] } },
        description: 'Name of the input binary property to upload',
      },
      {
        displayName: 'Display Name',
        name: 'fileDisplayName',
        type: 'string',
        default: '',
        displayOptions: { show: { resource: ['file'], operation: ['upload'] } },
        description: 'Optional display name. Defaults to the binary file name or property name.',
      },
      {
        displayName: 'MIME Type',
        name: 'fileMimeType',
        type: 'string',
        default: '',
        placeholder: 'application/pdf',
        displayOptions: { show: { resource: ['file'], operation: ['upload'] } },
        description: 'Override the binary MIME type. By default the input binary MIME type is used.',
      },
      {
        displayName: 'File Name',
        name: 'fileName',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'files/abc123',
        displayOptions: { show: { resource: ['file'], operation: ['get', 'delete'] } },
        description: 'Gemini file resource name',
      },
      {
        displayName: 'Options',
        name: 'listFileOptions',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        displayOptions: { show: { resource: ['file'], operation: ['list'] } },
        options: [
          {
            displayName: 'Page Size',
            name: 'pageSize',
            type: 'number',
            default: 50,
            typeOptions: { minValue: 1 },
          },
          {
            displayName: 'Page Token',
            name: 'pageToken',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Return Files as Separate Items',
            name: 'returnSeparateItems',
            type: 'boolean',
            default: true,
          },
        ],
      },

      // Cached Content
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'create',
        displayOptions: { show: { resource: ['cachedContent'] } },
        options: [
          { name: 'Create', value: 'create', action: 'Create cached content' },
          { name: 'Get', value: 'get', action: 'Get cached content' },
          { name: 'List', value: 'list', action: 'List cached content' },
          { name: 'Update', value: 'update', action: 'Update cached content' },
          { name: 'Delete', value: 'delete', action: 'Delete cached content' },
        ],
      },
      {
        displayName: 'Cached Content Name',
        name: 'cachedContentName',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'cachedContents/abc123',
        displayOptions: {
          show: { resource: ['cachedContent'], operation: ['get', 'update', 'delete'] },
        },
      },
      {
        displayName: 'Request Body (JSON)',
        name: 'cachedContentBodyJson',
        type: 'json',
        default: '{\n  "model": "models/gemini-flash-latest",\n  "contents": [\n    {\n      "parts": [\n        {\n          "text": "Context to cache"\n        }\n      ]\n    }\n  ]\n}',
        required: true,
        displayOptions: {
          show: { resource: ['cachedContent'], operation: ['create', 'update'] },
        },
        description: 'CachedContent request body',
      },
      {
        displayName: 'Update Mask',
        name: 'cachedContentUpdateMask',
        type: 'string',
        default: '',
        placeholder: 'ttl,expire_time',
        displayOptions: { show: { resource: ['cachedContent'], operation: ['update'] } },
        description: 'Comma-separated field mask for PATCH requests',
      },
      {
        displayName: 'Options',
        name: 'listCachedContentOptions',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        displayOptions: { show: { resource: ['cachedContent'], operation: ['list'] } },
        options: [
          {
            displayName: 'Page Size',
            name: 'pageSize',
            type: 'number',
            default: 50,
            typeOptions: { minValue: 1 },
          },
          {
            displayName: 'Page Token',
            name: 'pageToken',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Return Cached Contents as Separate Items',
            name: 'returnSeparateItems',
            type: 'boolean',
            default: true,
          },
        ],
      },

      // Token
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'count',
        displayOptions: { show: { resource: ['token'] } },
        options: [
          {
            name: 'Count Tokens',
            value: 'count',
            action: 'Count tokens for a Gemini request',
          },
        ],
      },
      {
        displayName: 'Model',
        name: 'tokenModel',
        type: 'options',
        default: 'gemini-flash-latest',
        required: true,
        typeOptions: { loadOptionsMethod: 'getModels' },
        allowArbitraryValues: true,
        displayOptions: { show: { resource: ['token'], operation: ['count'] } },
      },
      {
        displayName: 'Input Mode',
        name: 'tokenInputMode',
        type: 'options',
        default: 'simple',
        displayOptions: { show: { resource: ['token'], operation: ['count'] } },
        options: [
          { name: 'Simple Text', value: 'simple' },
          { name: 'Contents JSON', value: 'contentsJson' },
          { name: 'Generate Content Request JSON', value: 'generateRequestJson' },
          { name: 'Raw Request JSON', value: 'rawJson' },
        ],
      },
      {
        displayName: 'Text',
        name: 'tokenText',
        type: 'string',
        typeOptions: { rows: 5 },
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['token'], operation: ['count'], tokenInputMode: ['simple'] },
        },
      },
      {
        displayName: 'Contents (JSON)',
        name: 'tokenContentsJson',
        type: 'json',
        default: '[{"parts":[{"text":"Explain how AI works in a few words"}]}]',
        required: true,
        displayOptions: {
          show: { resource: ['token'], operation: ['count'], tokenInputMode: ['contentsJson'] },
        },
      },
      {
        displayName: 'Generate Content Request (JSON)',
        name: 'generateContentRequestJson',
        type: 'json',
        default: '{\n  "contents": [\n    {\n      "parts": [\n        {\n          "text": "Explain how AI works in a few words"\n        }\n      ]\n    }\n  ]\n}',
        required: true,
        description: 'generateContentRequest object for token counting with system instructions, tools, or config',
        displayOptions: {
          show: {
            resource: ['token'],
            operation: ['count'],
            tokenInputMode: ['generateRequestJson'],
          },
        },
      },
      {
        displayName: 'Raw Request Body (JSON)',
        name: 'rawCountTokensRequestJson',
        type: 'json',
        default: '{\n  "contents": [\n    {\n      "parts": [\n        {\n          "text": "Explain how AI works in a few words"\n        }\n      ]\n    }\n  ]\n}',
        required: true,
        description: 'Complete request body sent to :countTokens',
        displayOptions: {
          show: { resource: ['token'], operation: ['count'], tokenInputMode: ['rawJson'] },
        },
      },

      // Embedding
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'embed',
        displayOptions: { show: { resource: ['embedding'] } },
        options: [
          {
            name: 'Embed Content',
            value: 'embed',
            action: 'Generate embeddings with a Gemini embedding model',
          },
          {
            name: 'Batch Embed Contents',
            value: 'batchEmbed',
            action: 'Generate multiple embeddings with a Gemini embedding model',
          },
        ],
      },
      {
        displayName: 'Model',
        name: 'embeddingModel',
        type: 'options',
        default: 'gemini-embedding-2',
        required: true,
        description: 'Embedding model ID or resource name',
        typeOptions: { loadOptionsMethod: 'getModels' },
        allowArbitraryValues: true,
        displayOptions: { show: { resource: ['embedding'], operation: ['embed', 'batchEmbed'] } },
      },
      {
        displayName: 'Input Mode',
        name: 'embeddingInputMode',
        type: 'options',
        default: 'simple',
        displayOptions: { show: { resource: ['embedding'], operation: ['embed'] } },
        options: [
          { name: 'Simple Text', value: 'simple' },
          { name: 'Raw Request JSON', value: 'rawJson' },
        ],
      },
      {
        displayName: 'Batch Input Mode',
        name: 'batchEmbeddingInputMode',
        type: 'options',
        default: 'simpleList',
        displayOptions: { show: { resource: ['embedding'], operation: ['batchEmbed'] } },
        options: [
          { name: 'Simple Text List', value: 'simpleList' },
          { name: 'Texts JSON Array', value: 'textsJson' },
          { name: 'Raw Request JSON', value: 'rawJson' },
        ],
      },
      {
        displayName: 'Texts',
        name: 'batchEmbeddingTexts',
        type: 'string',
        typeOptions: { rows: 8 },
        default: '',
        required: true,
        description: 'One text per line',
        displayOptions: {
          show: { resource: ['embedding'], operation: ['batchEmbed'], batchEmbeddingInputMode: ['simpleList'] },
        },
      },
      {
        displayName: 'Texts (JSON Array)',
        name: 'batchEmbeddingTextsJson',
        type: 'json',
        default: '["What is the meaning of life?", "How does AI work?"]',
        required: true,
        displayOptions: {
          show: { resource: ['embedding'], operation: ['batchEmbed'], batchEmbeddingInputMode: ['textsJson'] },
        },
      },
      {
        displayName: 'Raw Request Body (JSON)',
        name: 'rawBatchEmbedRequestJson',
        type: 'json',
        default: '{\n  "requests": [\n    {\n      "content": {\n        "parts": [\n          {\n            "text": "What is the meaning of life?"\n          }\n        ]\n      }\n    }\n  ]\n}',
        required: true,
        description: 'Complete request body sent to :batchEmbedContents',
        displayOptions: {
          show: { resource: ['embedding'], operation: ['batchEmbed'], batchEmbeddingInputMode: ['rawJson'] },
        },
      },
      {
        displayName: 'Text',
        name: 'embeddingText',
        type: 'string',
        typeOptions: { rows: 5 },
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['embedding'], operation: ['embed'], embeddingInputMode: ['simple'] },
        },
      },
      {
        displayName: 'Raw Request Body (JSON)',
        name: 'rawEmbedRequestJson',
        type: 'json',
        default: '{\n  "content": {\n    "parts": [\n      {\n        "text": "What is the meaning of life?"\n      }\n    ]\n  }\n}',
        required: true,
        description: 'Complete request body sent to :embedContent',
        displayOptions: {
          show: { resource: ['embedding'], operation: ['embed'], embeddingInputMode: ['rawJson'] },
        },
      },
      {
        displayName: 'Options',
        name: 'embeddingOptions',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        displayOptions: { show: { resource: ['embedding'], operation: ['embed', 'batchEmbed'] } },
        options: [
          {
            displayName: 'Output Dimensionality',
            name: 'outputDimensionality',
            type: 'number',
            default: 768,
            typeOptions: { minValue: 1 },
            description: 'Optional output vector size, for example 768, 1536, or 3072',
          },
          {
            displayName: 'Task Type',
            name: 'taskType',
            type: 'options',
            default: 'SEMANTIC_SIMILARITY',
            description: 'Mainly for gemini-embedding-001. For gemini-embedding-2, format the text with task prefixes when needed.',
            options: [
              { name: 'Semantic Similarity', value: 'SEMANTIC_SIMILARITY' },
              { name: 'Classification', value: 'CLASSIFICATION' },
              { name: 'Clustering', value: 'CLUSTERING' },
              { name: 'Retrieval Document', value: 'RETRIEVAL_DOCUMENT' },
              { name: 'Retrieval Query', value: 'RETRIEVAL_QUERY' },
              { name: 'Code Retrieval Query', value: 'CODE_RETRIEVAL_QUERY' },
              { name: 'Question Answering', value: 'QUESTION_ANSWERING' },
              { name: 'Fact Verification', value: 'FACT_VERIFICATION' },
            ],
          },
          {
            displayName: 'Title',
            name: 'title',
            type: 'string',
            default: '',
            description: 'Optional title for retrieval-document embeddings',
          },
        ],
      },

      // Model
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'list',
        displayOptions: { show: { resource: ['model'] } },
        options: [
          { name: 'List', value: 'list', action: 'List Gemini models' },
          { name: 'Get', value: 'get', action: 'Get a Gemini model' },
        ],
      },
      {
        displayName: 'Model',
        name: 'modelName',
        type: 'options',
        default: 'gemini-flash-latest',
        required: true,
        typeOptions: { loadOptionsMethod: 'getModels' },
        allowArbitraryValues: true,
        displayOptions: { show: { resource: ['model'], operation: ['get'] } },
      },
      {
        displayName: 'Options',
        name: 'listModelOptions',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        displayOptions: { show: { resource: ['model'], operation: ['list'] } },
        options: [
          {
            displayName: 'Page Size',
            name: 'pageSize',
            type: 'number',
            default: 50,
            typeOptions: { minValue: 1 },
          },
          {
            displayName: 'Page Token',
            name: 'pageToken',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Return Models as Separate Items',
            name: 'returnSeparateItems',
            type: 'boolean',
            default: true,
          },
        ],
      },
    ],
  };

  methods = {
    loadOptions: {
      async getModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const credentials = (await this.getCredentials('googleGenerativeAiApi')) as Credentials;
        const response = await geminiRequest.call(this, 'GET', '/models', buildBaseUrl(credentials));
        const models = Array.isArray(response.models) ? response.models : [];

        return models
          .filter(isJsonObject)
          .map((model) => {
            const name = typeof model.name === 'string' ? model.name : '';
            const displayName = typeof model.displayName === 'string' ? model.displayName : name;
            const value = name.startsWith('models/') ? name.slice('models/'.length) : name;

            return {
              name: displayName && name ? `${displayName} (${name})` : name || displayName,
              value,
              description: typeof model.description === 'string' ? model.description : undefined,
            };
          })
          .filter((option) => Boolean(option.value));
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    const credentials = (await this.getCredentials('googleGenerativeAiApi')) as Credentials;
    const baseURL = buildBaseUrl(credentials);

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      try {
        const resource = this.getNodeParameter('resource', itemIndex) as string;
        const operation = this.getNodeParameter('operation', itemIndex) as string;

        const result = await executeOperation.call(this, resource, operation, itemIndex, baseURL);
        returnData.push(...result);
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({
            json: { error: error instanceof Error ? error.message : String(error) },
            pairedItem: { item: itemIndex },
          });
          continue;
        }

        if (error instanceof NodeOperationError) {
          throw error;
        }

        throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
      }
    }

    return [returnData, [], []];
  }

  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
    const credentials = (await this.getCredentials('googleGenerativeAiApi')) as Credentials;
    const baseURL = buildBaseUrl(credentials);
    const resource = this.getNodeParameter('resource', itemIndex) as string;

    if (resource === 'content') {
      const model = this.getNodeParameter('model', itemIndex) as string;
      return {
        response: new GeminiAiStudioChatModel({
          context: this,
          baseURL,
          model,
          systemInstruction: this.getNodeParameter('systemInstruction', itemIndex, '') as string,
          generateOptions: this.getNodeParameter('generateOptions', itemIndex, {}) as JsonObject,
        }),
      };
    }

    if (resource === 'embedding') {
      const model = this.getNodeParameter('embeddingModel', itemIndex) as string;
      return {
        response: new GeminiAiStudioEmbeddings({
          context: this,
          baseURL,
          model,
          options: this.getNodeParameter('embeddingOptions', itemIndex, {}) as JsonObject,
        }),
      };
    }

    throw new NodeOperationError(
      this.getNode(),
      'AI outputs are available when Resource is Content or Embedding.',
      { itemIndex },
    );
  }
}

async function executeOperation(
  this: IExecuteFunctions,
  resource: string,
  operation: string,
  itemIndex: number,
  baseURL: string,
): Promise<INodeExecutionData[]> {
  if (resource === 'content' && operation === 'generate') {
    const model = this.getNodeParameter('model', itemIndex) as string;
    const body = await buildGenerateBody.call(this, itemIndex);
    const response = await geminiRequest.call(this, 'POST', `/${modelPath(model)}:generateContent`, baseURL, body);

    return [
      {
        json: summarizeGenerateResponse(response, model),
        pairedItem: { item: itemIndex },
      },
    ];
  }

  if (resource === 'content' && operation === 'stream') {
    const model = this.getNodeParameter('model', itemIndex) as string;
    const body = await buildGenerateBody.call(this, itemIndex);
    const rawResponse = await geminiTextRequest.call(
      this,
      'POST',
      `/${modelPath(model)}:streamGenerateContent`,
      baseURL,
      body,
      { alt: 'sse' },
    );
    const chunks = parseStreamingResponse(rawResponse);

    return [
      {
        json: summarizeStreamGenerateResponse(chunks, model),
        pairedItem: { item: itemIndex },
      },
    ];
  }

  if (resource === 'token' && operation === 'count') {
    const model = this.getNodeParameter('tokenModel', itemIndex) as string;
    const body = buildCountTokensBody.call(this, itemIndex);
    const response = await geminiRequest.call(this, 'POST', `/${modelPath(model)}:countTokens`, baseURL, body);

    return [{ json: response, pairedItem: { item: itemIndex } }];
  }

  if (resource === 'embedding' && operation === 'embed') {
    const model = this.getNodeParameter('embeddingModel', itemIndex) as string;
    const body = buildEmbeddingBody.call(this, itemIndex, model);
    const response = await geminiRequest.call(this, 'POST', `/${modelPath(model)}:embedContent`, baseURL, body);

    return [
      {
        json: summarizeEmbeddingResponse(response, model),
        pairedItem: { item: itemIndex },
      },
    ];
  }

  if (resource === 'embedding' && operation === 'batchEmbed') {
    const model = this.getNodeParameter('embeddingModel', itemIndex) as string;
    const body = buildBatchEmbeddingBody.call(this, itemIndex, model);
    const response = await geminiRequest.call(this, 'POST', `/${modelPath(model)}:batchEmbedContents`, baseURL, body);

    return [
      {
        json: summarizeBatchEmbeddingResponse(response, model),
        pairedItem: { item: itemIndex },
      },
    ];
  }

  if (resource === 'file') {
    return executeFileOperation.call(this, operation, itemIndex, baseURL);
  }

  if (resource === 'cachedContent') {
    return executeCachedContentOperation.call(this, operation, itemIndex, baseURL);
  }

  if (resource === 'model' && operation === 'list') {
    const options = this.getNodeParameter('listModelOptions', itemIndex, {}) as JsonObject;
    const qs: JsonObject = {};
    if (typeof options.pageSize === 'number') qs.pageSize = options.pageSize;
    if (typeof options.pageToken === 'string' && options.pageToken.trim()) qs.pageToken = options.pageToken.trim();

    const response = await geminiRequest.call(this, 'GET', '/models', baseURL, undefined, qs);
    const returnSeparateItems = options.returnSeparateItems !== false;

    if (returnSeparateItems && Array.isArray(response.models)) {
      return response.models.map((model) => ({
        json: model as JsonObject,
        pairedItem: { item: itemIndex },
      }));
    }

    return [{ json: response, pairedItem: { item: itemIndex } }];
  }

  if (resource === 'model' && operation === 'get') {
    const model = this.getNodeParameter('modelName', itemIndex) as string;
    const response = await geminiRequest.call(this, 'GET', `/${modelPath(model)}`, baseURL);

    return [{ json: response, pairedItem: { item: itemIndex } }];
  }

  throw new NodeOperationError(this.getNode(), `Unsupported operation: ${resource}.${operation}`, { itemIndex });
}

async function executeFileOperation(
  this: IExecuteFunctions,
  operation: string,
  itemIndex: number,
  baseURL: string,
): Promise<INodeExecutionData[]> {
  if (operation === 'upload') {
    const binaryPropertyName = this.getNodeParameter('fileBinaryPropertyName', itemIndex) as string;
    const binaryData = this.getInputData()[itemIndex]?.binary?.[binaryPropertyName] as IBinaryData | undefined;
    if (!binaryData) {
      throw new NodeOperationError(this.getNode(), `Binary property "${binaryPropertyName}" was not found`, {
        itemIndex,
      });
    }

    const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);
    const mimeTypeOverride = (this.getNodeParameter('fileMimeType', itemIndex, '') as string).trim();
    const displayNameOverride = (this.getNodeParameter('fileDisplayName', itemIndex, '') as string).trim();
    const response = await uploadFile.call(this, {
      baseURL,
      buffer,
      mimeType: mimeTypeOverride || binaryData.mimeType || 'application/octet-stream',
      displayName: displayNameOverride || binaryData.fileName || binaryPropertyName,
    });

    return [{ json: response, pairedItem: { item: itemIndex } }];
  }

  if (operation === 'list') {
    const options = this.getNodeParameter('listFileOptions', itemIndex, {}) as JsonObject;
    const qs = paginationQs(options);
    const response = await geminiRequest.call(this, 'GET', '/files', baseURL, undefined, qs);
    const returnSeparateItems = options.returnSeparateItems !== false;

    if (returnSeparateItems && Array.isArray(response.files)) {
      return response.files.filter(isJsonObject).map((file) => ({
        json: file,
        pairedItem: { item: itemIndex },
      }));
    }

    return [{ json: response, pairedItem: { item: itemIndex } }];
  }

  if (operation === 'get') {
    const name = this.getNodeParameter('fileName', itemIndex) as string;
    const response = await geminiRequest.call(this, 'GET', `/${resourcePath(name, 'files')}`, baseURL);
    return [{ json: response, pairedItem: { item: itemIndex } }];
  }

  if (operation === 'delete') {
    const name = this.getNodeParameter('fileName', itemIndex) as string;
    const response = await geminiRequest.call(this, 'DELETE', `/${resourcePath(name, 'files')}`, baseURL);
    return [{ json: response, pairedItem: { item: itemIndex } }];
  }

  throw new NodeOperationError(this.getNode(), `Unsupported file operation: ${operation}`, { itemIndex });
}

async function executeCachedContentOperation(
  this: IExecuteFunctions,
  operation: string,
  itemIndex: number,
  baseURL: string,
): Promise<INodeExecutionData[]> {
  if (operation === 'create') {
    const body = parseJsonObject(this.getNodeParameter('cachedContentBodyJson', itemIndex), 'Request Body');
    const response = await geminiRequest.call(this, 'POST', '/cachedContents', baseURL, body);
    return [{ json: response, pairedItem: { item: itemIndex } }];
  }

  if (operation === 'list') {
    const options = this.getNodeParameter('listCachedContentOptions', itemIndex, {}) as JsonObject;
    const qs = paginationQs(options);
    const response = await geminiRequest.call(this, 'GET', '/cachedContents', baseURL, undefined, qs);
    const returnSeparateItems = options.returnSeparateItems !== false;

    if (returnSeparateItems && Array.isArray(response.cachedContents)) {
      return response.cachedContents.filter(isJsonObject).map((cachedContent) => ({
        json: cachedContent,
        pairedItem: { item: itemIndex },
      }));
    }

    return [{ json: response, pairedItem: { item: itemIndex } }];
  }

  if (operation === 'get') {
    const name = this.getNodeParameter('cachedContentName', itemIndex) as string;
    const response = await geminiRequest.call(this, 'GET', `/${resourcePath(name, 'cachedContents')}`, baseURL);
    return [{ json: response, pairedItem: { item: itemIndex } }];
  }

  if (operation === 'update') {
    const name = this.getNodeParameter('cachedContentName', itemIndex) as string;
    const body = parseJsonObject(this.getNodeParameter('cachedContentBodyJson', itemIndex), 'Request Body');
    const updateMask = (this.getNodeParameter('cachedContentUpdateMask', itemIndex, '') as string).trim();
    const qs = updateMask ? { updateMask } : undefined;
    const response = await geminiRequest.call(
      this,
      'PATCH',
      `/${resourcePath(name, 'cachedContents')}`,
      baseURL,
      body,
      qs,
    );
    return [{ json: response, pairedItem: { item: itemIndex } }];
  }

  if (operation === 'delete') {
    const name = this.getNodeParameter('cachedContentName', itemIndex) as string;
    const response = await geminiRequest.call(this, 'DELETE', `/${resourcePath(name, 'cachedContents')}`, baseURL);
    return [{ json: response, pairedItem: { item: itemIndex } }];
  }

  throw new NodeOperationError(this.getNode(), `Unsupported cached content operation: ${operation}`, { itemIndex });
}

async function buildGenerateBody(this: IExecuteFunctions, itemIndex: number): Promise<JsonObject> {
  const inputMode = this.getNodeParameter('contentInputMode', itemIndex) as string;

  if (inputMode === 'rawJson') {
    return parseJsonObject(this.getNodeParameter('rawGenerateRequestJson', itemIndex), 'Raw Request Body');
  }

  const body: JsonObject = {};

  if (inputMode === 'simple') {
    const prompt = this.getNodeParameter('prompt', itemIndex) as string;
    body.contents = [
      {
        parts: await buildSimpleContentParts.call(this, itemIndex, prompt),
      },
    ];
  } else {
    body.contents = parseJsonArray(this.getNodeParameter('contentsJson', itemIndex), 'Contents');
  }

  const systemInstruction = (this.getNodeParameter('systemInstruction', itemIndex, '') as string).trim();
  if (systemInstruction) {
    body.system_instruction = { parts: [{ text: systemInstruction }] };
  }

  applyGenerateOptions(body, this.getNodeParameter('generateOptions', itemIndex, {}) as JsonObject);

  return body;
}

function applyGenerateOptions(body: JsonObject, options: JsonObject): void {
  const generationConfig = parseOptionalJsonObject(options.generationConfig, 'Generation Config') ?? {};

  assignIfPresent(generationConfig, 'candidateCount', options.candidateCount);
  assignIfPresent(generationConfig, 'frequencyPenalty', options.frequencyPenalty);
  assignIfPresent(generationConfig, 'maxOutputTokens', options.maxOutputTokens);
  assignIfPresent(generationConfig, 'presencePenalty', options.presencePenalty);
  assignIfPresent(generationConfig, 'responseMimeType', options.responseMimeType);
  assignIfPresent(generationConfig, 'seed', options.seed);
  assignIfPresent(generationConfig, 'temperature', options.temperature);
  assignIfPresent(generationConfig, 'topK', options.topK);
  assignIfPresent(generationConfig, 'topP', options.topP);

  const stopSequences = splitLines(options.stopSequences);
  if (stopSequences.length > 0) {
    generationConfig.stopSequences = stopSequences;
  }

  const responseSchema = parseOptionalJsonObject(options.responseSchema, 'Response Schema');
  if (responseSchema && Object.keys(responseSchema).length > 0) {
    generationConfig.responseSchema = responseSchema;
  }

  const thinkingConfig: JsonObject = {};
  if (typeof options.thinkingBudget === 'number' && options.thinkingBudget > 0) {
    thinkingConfig.thinkingBudget = options.thinkingBudget;
  } else {
    assignIfPresent(thinkingConfig, 'thinkingLevel', options.thinkingLevel);
  }
  if (Object.keys(thinkingConfig).length > 0) {
    generationConfig.thinkingConfig = {
      ...((generationConfig.thinkingConfig as JsonObject | undefined) ?? {}),
      ...thinkingConfig,
    };
  }

  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }

  const safetySettings = parseOptionalJsonArray(options.safetySettings, 'Safety Settings');
  if (safetySettings && safetySettings.length > 0) {
    body.safetySettings = safetySettings;
  }

  const tools = parseOptionalJsonArray(options.tools, 'Tools') ?? [];
  const functionDeclarations = buildFunctionDeclarations(options.functionDeclarations);
  if (functionDeclarations.length > 0) {
    tools.push({ functionDeclarations });
  }
  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  const toolConfig = parseOptionalJsonObject(options.toolConfig, 'Tool Config');
  if (toolConfig && Object.keys(toolConfig).length > 0) {
    body.toolConfig = toolConfig;
  }

  if (typeof options.cachedContent === 'string' && options.cachedContent.trim()) {
    body.cachedContent = options.cachedContent.trim();
  }
}

async function buildSimpleContentParts(
  this: IExecuteFunctions,
  itemIndex: number,
  prompt: string,
): Promise<JsonObject[]> {
  const parts: JsonObject[] = [];
  if (prompt) {
    parts.push({ text: prompt });
  }

  const multimodalParts = this.getNodeParameter('multimodalParts', itemIndex, {}) as JsonObject;
  const binaryParts = normalizeCollectionItems(multimodalParts.binaryParts);
  for (const binaryPart of binaryParts) {
    const binaryPropertyName = typeof binaryPart.binaryPropertyName === 'string' ? binaryPart.binaryPropertyName.trim() : '';
    if (!binaryPropertyName) {
      throw new NodeOperationError(this.getNode(), 'Binary Property is required for every binary multimodal part', {
        itemIndex,
      });
    }

    const binaryData = this.getInputData()[itemIndex]?.binary?.[binaryPropertyName] as IBinaryData | undefined;
    if (!binaryData) {
      throw new NodeOperationError(this.getNode(), `Binary property "${binaryPropertyName}" was not found`, {
        itemIndex,
      });
    }

    const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);
    const mimeType = typeof binaryPart.mimeType === 'string' && binaryPart.mimeType.trim()
      ? binaryPart.mimeType.trim()
      : binaryData.mimeType;

    parts.push({
      inlineData: {
        mimeType: mimeType || 'application/octet-stream',
        data: buffer.toString('base64'),
      },
    });
  }

  const fileDataParts = normalizeCollectionItems(multimodalParts.fileDataParts);
  for (const fileDataPart of fileDataParts) {
    const fileUri = typeof fileDataPart.fileUri === 'string' ? fileDataPart.fileUri.trim() : '';
    const mimeType = typeof fileDataPart.mimeType === 'string' ? fileDataPart.mimeType.trim() : '';
    if (!fileUri || !mimeType) {
      throw new NodeOperationError(this.getNode(), 'File URI and MIME Type are required for every fileData part', {
        itemIndex,
      });
    }

    parts.push({
      fileData: {
        mimeType,
        fileUri,
      },
    });
  }

  if (parts.length === 0) {
    throw new Error('Prompt or at least one multimodal part is required');
  }

  return parts;
}

function buildFunctionDeclarations(raw: unknown): JsonObject[] {
  const collection = isJsonObject(raw) ? raw : {};
  const declarations = normalizeCollectionItems(collection.functionDeclaration);

  return declarations
    .map((declaration) => {
      const name = typeof declaration.name === 'string' ? declaration.name.trim() : '';
      if (!name) {
        return undefined;
      }

      const functionDeclaration: JsonObject = { name };
      assignIfPresent(functionDeclaration, 'description', declaration.description);

      const parameters = parseOptionalJsonObject(declaration.parametersJson, `Parameters Schema for ${name}`);
      if (parameters && Object.keys(parameters).length > 0) {
        functionDeclaration.parameters = parameters;
      }

      return functionDeclaration;
    })
    .filter((declaration): declaration is JsonObject => declaration !== undefined);
}

function buildCountTokensBody(this: IExecuteFunctions, itemIndex: number): JsonObject {
  const inputMode = this.getNodeParameter('tokenInputMode', itemIndex) as string;

  if (inputMode === 'rawJson') {
    return parseJsonObject(this.getNodeParameter('rawCountTokensRequestJson', itemIndex), 'Raw Request Body');
  }

  if (inputMode === 'generateRequestJson') {
    return {
      generateContentRequest: parseJsonObject(
        this.getNodeParameter('generateContentRequestJson', itemIndex),
        'Generate Content Request',
      ),
    };
  }

  if (inputMode === 'simple') {
    return { contents: textContents(this.getNodeParameter('tokenText', itemIndex) as string) };
  }

  return {
    contents: parseJsonArray(this.getNodeParameter('tokenContentsJson', itemIndex), 'Contents'),
  };
}

function buildEmbeddingBody(this: IExecuteFunctions, itemIndex: number, model: string): JsonObject {
  const inputMode = this.getNodeParameter('embeddingInputMode', itemIndex) as string;

  if (inputMode === 'rawJson') {
    return parseJsonObject(this.getNodeParameter('rawEmbedRequestJson', itemIndex), 'Raw Request Body');
  }

  const options = this.getNodeParameter('embeddingOptions', itemIndex, {}) as JsonObject;
  const body: JsonObject = {
    model: toModelResource(model),
    content: {
      parts: [{ text: this.getNodeParameter('embeddingText', itemIndex) as string }],
    },
  };

  assignIfPresent(body, 'taskType', options.taskType);
  assignIfPresent(body, 'title', options.title);

  if (typeof options.outputDimensionality === 'number' && options.outputDimensionality > 0) {
    body.output_dimensionality = options.outputDimensionality;
  }

  return body;
}

function buildBatchEmbeddingBody(this: IExecuteFunctions, itemIndex: number, model: string): JsonObject {
  const inputMode = this.getNodeParameter('batchEmbeddingInputMode', itemIndex) as string;

  if (inputMode === 'rawJson') {
    const body = parseJsonObject(this.getNodeParameter('rawBatchEmbedRequestJson', itemIndex), 'Raw Request Body');
    ensureBatchRequestsHaveModel(body, model);
    return body;
  }

  const texts =
    inputMode === 'textsJson'
      ? parseStringArray(this.getNodeParameter('batchEmbeddingTextsJson', itemIndex), 'Texts')
      : splitLines(this.getNodeParameter('batchEmbeddingTexts', itemIndex));

  if (texts.length === 0) {
    throw new Error('At least one text is required for batch embeddings');
  }

  const options = this.getNodeParameter('embeddingOptions', itemIndex, {}) as JsonObject;
  return buildBatchEmbeddingRequest(texts, model, options);
}

async function geminiRequest(
  this: RequestContext,
  method: IHttpRequestMethods,
  url: string,
  baseURL: string,
  body?: JsonObject | Buffer,
  qs?: JsonObject,
  headers?: JsonObject,
): Promise<JsonObject> {
  const options: IHttpRequestOptions = {
    method,
    url,
    json: true,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (baseURL) {
    options.baseURL = baseURL;
  }

  if (body !== undefined) {
    options.body = body;
    if (Buffer.isBuffer(body)) {
      options.json = false;
    }
  }

  if (qs && Object.keys(qs).length > 0) {
    options.qs = qs;
  }

  return normalizeJsonObject(await authenticatedRequest.call(this, options));
}

async function geminiTextRequest(
  this: RequestContext,
  method: IHttpRequestMethods,
  url: string,
  baseURL: string,
  body?: JsonObject,
  qs?: JsonObject,
): Promise<string> {
  const options: IHttpRequestOptions = {
    method,
    baseURL,
    url,
    json: false,
    encoding: 'text',
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  if (qs && Object.keys(qs).length > 0) {
    options.qs = qs;
  }

  const response = await authenticatedRequest.call(this, options);
  return typeof response === 'string' ? response : JSON.stringify(response);
}

async function geminiFullRequest(
  this: RequestContext,
  options: IHttpRequestOptions,
): Promise<IN8nHttpFullResponse> {
  const response = await authenticatedRequest.call(this, { ...options, returnFullResponse: true });
  return response as IN8nHttpFullResponse;
}

async function authenticatedRequest(this: RequestContext, options: IHttpRequestOptions): Promise<unknown> {
  try {
    return await this.helpers.httpRequestWithAuthentication.call(this, 'googleGenerativeAiApi', options);
  } catch (error) {
    throw new Error(formatGeminiRequestError(error));
  }
}

async function uploadFile(
  this: IExecuteFunctions,
  input: {
    baseURL: string;
    buffer: Buffer;
    mimeType: string;
    displayName: string;
  },
): Promise<JsonObject> {
  const uploadBaseURL = buildUploadBaseUrl(input.baseURL);
  const startResponse = await geminiFullRequest.call(this, {
    method: 'POST',
    baseURL: uploadBaseURL,
    url: '/files',
    json: true,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(input.buffer.length),
      'X-Goog-Upload-Header-Content-Type': input.mimeType,
    },
    body: {
      file: {
        display_name: input.displayName,
      },
    },
  });

  const uploadUrl = getHeaderValue(startResponse.headers, 'x-goog-upload-url');
  if (!uploadUrl) {
    throw new Error('Gemini Files API did not return an upload URL');
  }

  return geminiRequest.call(this, 'POST', uploadUrl, '', input.buffer, undefined, {
    'Content-Type': input.mimeType,
    'Content-Length': String(input.buffer.length),
    'X-Goog-Upload-Offset': '0',
    'X-Goog-Upload-Command': 'upload, finalize',
  });
}

function buildBaseUrl(credentials: Credentials): string {
  const baseUrl = trimTrailingSlash(credentials.baseUrl || 'https://generativelanguage.googleapis.com');
  const apiVersion = trimSlashes(credentials.apiVersion || 'v1beta');
  return `${baseUrl}/${apiVersion}`;
}

function buildUploadBaseUrl(apiBaseURL: string): string {
  const match = apiBaseURL.match(/^(https?:\/\/[^/]+)\/(.+)$/);
  if (!match) {
    throw new Error('Base URL must include protocol and host for file uploads');
  }

  return `${match[1]}/upload/${trimSlashes(match[2])}`;
}

function getHeaderValue(headers: IDataObject, headerName: string): string | undefined {
  const target = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) {
      continue;
    }

    if (Array.isArray(value)) {
      const first = value[0];
      return typeof first === 'string' ? first : undefined;
    }

    return typeof value === 'string' ? value : String(value);
  }

  return undefined;
}

function formatGeminiRequestError(error: unknown): string {
  const fallback = error instanceof Error ? error.message : String(error);
  const errorObject = isJsonObject(error) ? error : undefined;
  const response = isJsonObject(errorObject?.response) ? errorObject.response : undefined;
  const body = response?.body ?? response?.data;
  const parsedBody = typeof body === 'string' ? parseJsonIfPossible(body) : body;
  const geminiError = isJsonObject(parsedBody) && isJsonObject(parsedBody.error) ? parsedBody.error : undefined;
  const message = typeof geminiError?.message === 'string' ? geminiError.message : undefined;
  const status = response?.statusCode ?? response?.status;

  if (message && status) {
    return `Gemini API request failed (${status}): ${message}`;
  }

  if (message) {
    return `Gemini API request failed: ${message}`;
  }

  return fallback;
}

function parseJsonIfPossible(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function summarizeGenerateResponse(response: JsonObject, model: string): JsonObject {
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  const firstCandidate = candidates[0] as JsonObject | undefined;
  const texts = extractCandidateTexts(response);

  return {
    text: texts[0] ?? '',
    texts,
    finishReason: firstCandidate?.finishReason,
    model,
    response,
  };
}

function summarizeStreamGenerateResponse(chunks: JsonObject[], model: string): JsonObject {
  const texts = chunks.map((chunk) => extractCandidateTexts(chunk)[0] ?? '').filter(Boolean);

  return {
    text: texts.join(''),
    texts,
    model,
    chunks,
  };
}

function summarizeEmbeddingResponse(response: JsonObject, model: string): JsonObject {
  const embedding = response.embedding ?? (Array.isArray(response.embeddings) ? response.embeddings[0] : undefined);

  return {
    model,
    embedding,
    response,
  };
}

function summarizeBatchEmbeddingResponse(response: JsonObject, model: string): JsonObject {
  const embeddings = Array.isArray(response.embeddings) ? response.embeddings : [];

  return {
    model,
    embeddings,
    response,
  };
}

function extractText(response: JsonObject): string {
  return extractCandidateTexts(response).join('');
}

function extractCandidateTexts(response: JsonObject): string[] {
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  const candidateTexts: string[] = [];

  for (const candidate of candidates) {
    if (!isJsonObject(candidate) || !isJsonObject(candidate.content) || !Array.isArray(candidate.content.parts)) {
      continue;
    }

    const textParts: string[] = [];
    for (const part of candidate.content.parts) {
      if (isJsonObject(part) && typeof part.text === 'string') {
        textParts.push(part.text);
      }
    }

    candidateTexts.push(textParts.join(''));
  }

  return candidateTexts;
}

function textContents(text: string): JsonObject[] {
  return [
    {
      parts: [{ text }],
    },
  ];
}

function messagesToGeminiContents(messages: BaseMessage[]): JsonObject[] {
  return messages
    .filter((message) => message.type !== 'system')
    .map((message) => ({
      role: message.type === 'ai' ? 'model' : 'user',
      parts: [{ text: message.text }],
    }));
}

function buildBatchEmbeddingRequest(texts: string[], model: string, options: JsonObject): JsonObject {
  const modelResource = toModelResource(model);
  const requests = texts.map((text) => {
    const request: JsonObject = {
      model: modelResource,
      content: {
        parts: [{ text }],
      },
    };

    assignIfPresent(request, 'taskType', options.taskType);
    assignIfPresent(request, 'title', options.title);

    if (typeof options.outputDimensionality === 'number' && options.outputDimensionality > 0) {
      request.output_dimensionality = options.outputDimensionality;
    }

    return request;
  });

  return { requests };
}

function ensureBatchRequestsHaveModel(body: JsonObject, model: string): void {
  if (!Array.isArray(body.requests)) {
    throw new Error('Raw Request Body must contain a requests array');
  }

  const modelResource = toModelResource(model);
  for (const request of body.requests) {
    if (isJsonObject(request) && typeof request.model !== 'string') {
      request.model = modelResource;
    }
  }
}

function extractEmbeddings(response: JsonObject): number[][] {
  if (!Array.isArray(response.embeddings)) {
    return [];
  }

  return response.embeddings.map(extractEmbeddingValues);
}

function extractEmbeddingValues(embedding: unknown): number[] {
  if (!isJsonObject(embedding) || !Array.isArray(embedding.values)) {
    return [];
  }

  return embedding.values.filter((value): value is number => typeof value === 'number');
}

function toModelResource(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    throw new Error('Model must not be empty');
  }
  return trimmed.startsWith('models/') ? trimmed : `models/${trimmed}`;
}

function modelPath(model: string): string {
  return toModelResource(model)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function parseJsonObject(raw: unknown, label: string): JsonObject {
  const parsed = parseJson(raw, label);
  if (!isJsonObject(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}

function parseJsonArray(raw: unknown, label: string): unknown[] {
  const parsed = parseJson(raw, label);
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array`);
  }
  return parsed;
}

function parseStringArray(raw: unknown, label: string): string[] {
  const parsed = parseJsonArray(raw, label);
  const invalidIndex = parsed.findIndex((value) => typeof value !== 'string');
  if (invalidIndex !== -1) {
    throw new Error(`${label} must be a JSON array of strings`);
  }

  return (parsed as string[]).map((value) => value.trim()).filter(Boolean);
}

function parseOptionalJsonObject(raw: unknown, label: string): JsonObject | undefined {
  if (raw == null || raw === '') return undefined;
  return parseJsonObject(raw, label);
}

function parseOptionalJsonArray(raw: unknown, label: string): unknown[] | undefined {
  if (raw == null || raw === '') return undefined;
  return parseJsonArray(raw, label);
}

function parseJson(raw: unknown, label: string): unknown {
  if (typeof raw === 'object' && raw !== null) {
    return raw;
  }

  if (typeof raw !== 'string') {
    throw new Error(`${label} must be valid JSON`);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${(error as Error).message}`);
  }
}

function assignIfPresent(target: JsonObject, key: string, value: unknown): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      target[key] = trimmed;
    }
    return;
  }

  if (value !== undefined && value !== null) {
    target[key] = value;
  }
}

function normalizeCollectionItems(value: unknown): JsonObject[] {
  if (Array.isArray(value)) {
    return value.filter(isJsonObject);
  }

  return isJsonObject(value) ? [value] : [];
}

function paginationQs(options: JsonObject): JsonObject {
  const qs: JsonObject = {};
  if (typeof options.pageSize === 'number') qs.pageSize = options.pageSize;
  if (typeof options.pageToken === 'string' && options.pageToken.trim()) qs.pageToken = options.pageToken.trim();
  return qs;
}

function resourcePath(name: string, prefix: string): string {
  const trimmed = trimSlashes(name.trim());
  if (!trimmed) {
    throw new Error(`${prefix} resource name must not be empty`);
  }

  const resourceName = trimmed.startsWith(`${prefix}/`) ? trimmed : `${prefix}/${trimmed}`;
  return resourceName
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function normalizeJsonObject(response: unknown): JsonObject {
  if (isJsonObject(response)) {
    return response;
  }

  if (response == null || response === '') {
    return {};
  }

  return { response };
}

function parseStreamingResponse(rawResponse: string): JsonObject[] {
  const trimmed = rawResponse.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    const parsed = parseJsonArray(trimmed, 'Streaming Response');
    return parsed.filter(isJsonObject);
  }

  if (trimmed.startsWith('{')) {
    return [parseJsonObject(trimmed, 'Streaming Response')];
  }

  const chunks: JsonObject[] = [];
  for (const event of trimmed.split(/\r?\n\r?\n+/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .join('\n');

    if (!data || data === '[DONE]') {
      continue;
    }

    chunks.push(parseJsonObject(data, 'Streaming Response Event'));
  }

  return chunks;
}

function splitLines(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
