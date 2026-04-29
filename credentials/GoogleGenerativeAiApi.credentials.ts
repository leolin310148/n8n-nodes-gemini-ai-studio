import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class GoogleGenerativeAiApi implements ICredentialType {
  name = 'googleGenerativeAiApi';
  displayName = 'Google Generative AI API';
  documentationUrl = 'https://ai.google.dev/gemini-api/docs/api-key';

  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description: 'Gemini API key from Google AI Studio',
    },
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://generativelanguage.googleapis.com',
      placeholder: 'https://generativelanguage.googleapis.com',
      description: 'Root URL for the Gemini API. Leave unchanged for Google AI Studio.',
    },
    {
      displayName: 'API Version',
      name: 'apiVersion',
      type: 'options',
      default: 'v1beta',
      options: [
        { name: 'v1beta', value: 'v1beta' },
        { name: 'v1', value: 'v1' },
      ],
      description: 'Gemini API version to use for requests',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        'X-goog-api-key': '={{ $credentials.apiKey }}',
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{ $credentials.baseUrl.replace(/\\/$/, "") }}',
      url: '={{ "/" + $credentials.apiVersion + "/models" }}',
      method: 'GET',
    },
  };
}
