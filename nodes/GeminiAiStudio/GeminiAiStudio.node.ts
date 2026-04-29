import type {
  IExecuteFunctions,
  IDataObject,
  IHttpRequestMethods,
  IHttpRequestOptions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

type JsonObject = IDataObject;

type Credentials = {
  baseUrl?: string;
  apiVersion?: string;
};

export class GeminiAiStudio implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Gemini AI Studio',
    name: 'geminiAiStudio',
    icon: 'file:geminiAiStudio.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
    description: 'Use the Google Gemini API through direct AI Studio REST calls',
    defaults: { name: 'Gemini AI Studio' },
    inputs: ['main'],
    outputs: ['main'],
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
          { name: 'Embedding', value: 'embedding' },
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
        ],
      },
      {
        displayName: 'Model',
        name: 'model',
        type: 'string',
        default: 'gemini-flash-latest',
        required: true,
        placeholder: 'gemini-flash-latest',
        description: 'Model ID or resource name, for example gemini-3-flash-preview or models/gemini-flash-latest',
        displayOptions: { show: { resource: ['content'], operation: ['generate'] } },
      },
      {
        displayName: 'Input Mode',
        name: 'contentInputMode',
        type: 'options',
        default: 'simple',
        displayOptions: { show: { resource: ['content'], operation: ['generate'] } },
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
          show: { resource: ['content'], operation: ['generate'], contentInputMode: ['simple'] },
        },
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
            operation: ['generate'],
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
          show: { resource: ['content'], operation: ['generate'], contentInputMode: ['rawJson'] },
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
            operation: ['generate'],
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
        displayOptions: { show: { resource: ['content'], operation: ['generate'] } },
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
            default: '{}',
            description: 'Raw generationConfig object. Specific fields below override matching keys.',
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
            default: '{}',
            description: 'JSON schema for structured output. Usually used with Response MIME Type application/json.',
          },
          {
            displayName: 'Safety Settings (JSON)',
            name: 'safetySettings',
            type: 'json',
            default: '[]',
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
            description: 'Optional thinking token budget. 0 means omitted.',
          },
          {
            displayName: 'Thinking Level',
            name: 'thinkingLevel',
            type: 'options',
            default: 'low',
            options: [
              { name: 'Low', value: 'low' },
              { name: 'Medium', value: 'medium' },
              { name: 'High', value: 'high' },
            ],
          },
          {
            displayName: 'Tool Config (JSON)',
            name: 'toolConfig',
            type: 'json',
            default: '{}',
            description: 'Gemini toolConfig object',
          },
          {
            displayName: 'Tools (JSON)',
            name: 'tools',
            type: 'json',
            default: '[]',
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
        type: 'string',
        default: 'gemini-flash-latest',
        required: true,
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
        ],
      },
      {
        displayName: 'Model',
        name: 'embeddingModel',
        type: 'string',
        default: 'gemini-embedding-2',
        required: true,
        description: 'Embedding model ID or resource name',
        displayOptions: { show: { resource: ['embedding'], operation: ['embed'] } },
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
        displayOptions: { show: { resource: ['embedding'], operation: ['embed'] } },
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
        type: 'string',
        default: 'gemini-flash-latest',
        required: true,
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

    return [returnData];
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
    const body = buildGenerateBody.call(this, itemIndex);
    const response = await geminiRequest.call(this, 'POST', `/${modelPath(model)}:generateContent`, baseURL, body);

    return [
      {
        json: summarizeGenerateResponse(response, model),
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

function buildGenerateBody(this: IExecuteFunctions, itemIndex: number): JsonObject {
  const inputMode = this.getNodeParameter('contentInputMode', itemIndex) as string;

  if (inputMode === 'rawJson') {
    return parseJsonObject(this.getNodeParameter('rawGenerateRequestJson', itemIndex), 'Raw Request Body');
  }

  const body: JsonObject = {};

  if (inputMode === 'simple') {
    const prompt = this.getNodeParameter('prompt', itemIndex) as string;
    body.contents = textContents(prompt);
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
  assignIfPresent(thinkingConfig, 'thinkingLevel', options.thinkingLevel);
  if (typeof options.thinkingBudget === 'number' && options.thinkingBudget > 0) {
    thinkingConfig.thinkingBudget = options.thinkingBudget;
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

  const tools = parseOptionalJsonArray(options.tools, 'Tools');
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

async function geminiRequest(
  this: IExecuteFunctions,
  method: IHttpRequestMethods,
  url: string,
  baseURL: string,
  body?: JsonObject,
  qs?: JsonObject,
): Promise<JsonObject> {
  const options: IHttpRequestOptions = {
    method,
    baseURL,
    url,
    json: true,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body !== undefined) {
    options.body = body;
  }

  if (qs && Object.keys(qs).length > 0) {
    options.qs = qs;
  }

  return (await this.helpers.httpRequestWithAuthentication.call(
    this,
    'googleGenerativeAiApi',
    options,
  )) as JsonObject;
}

function buildBaseUrl(credentials: Credentials): string {
  const baseUrl = trimTrailingSlash(credentials.baseUrl || 'https://generativelanguage.googleapis.com');
  const apiVersion = trimSlashes(credentials.apiVersion || 'v1beta');
  return `${baseUrl}/${apiVersion}`;
}

function summarizeGenerateResponse(response: JsonObject, model: string): JsonObject {
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  const firstCandidate = candidates[0] as JsonObject | undefined;

  return {
    text: extractText(response),
    finishReason: firstCandidate?.finishReason,
    model,
    response,
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

function extractText(response: JsonObject): string {
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  const textParts: string[] = [];

  for (const candidate of candidates) {
    if (!isJsonObject(candidate) || !isJsonObject(candidate.content) || !Array.isArray(candidate.content.parts)) {
      continue;
    }

    for (const part of candidate.content.parts) {
      if (isJsonObject(part) && typeof part.text === 'string') {
        textParts.push(part.text);
      }
    }
  }

  return textParts.join('');
}

function textContents(text: string): JsonObject[] {
  return [
    {
      parts: [{ text }],
    },
  ];
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
