type Fetch = typeof fetch;
/**
 * microCMS createClient params
 */
interface MicroCMSClient {
    serviceDomain: string;
    apiKey: string;
    retry?: boolean;
}
/**
 * microCMS createManagementClient params
 */
interface MicroCMSManagementClient {
    serviceDomain: string;
    apiKey: string;
}
type depthNumber = 0 | 1 | 2 | 3;
/**
 * microCMS queries
 * https://document.microcms.io/content-api/get-list-contents#h9ce528688c
 * https://document.microcms.io/content-api/get-content#h9ce528688c
 */
interface MicroCMSQueries {
    draftKey?: string;
    limit?: number;
    offset?: number;
    orders?: string;
    fields?: string | string[];
    q?: string;
    depth?: depthNumber;
    ids?: string | string[];
    filters?: string;
    richEditorFormat?: 'html' | 'object';
}
/**
 * microCMS contentId
 * https://document.microcms.io/manual/content-id-setting
 */
interface MicroCMSContentId {
    id: string;
}
/**
 * microCMS content common date
 */
interface MicroCMSDate {
    createdAt: string;
    updatedAt: string;
    publishedAt?: string;
    revisedAt?: string;
}
/**
 * microCMS image
 */
interface MicroCMSImage {
    url: string;
    width?: number;
    height?: number;
    alt?: string;
}
/**
 * microCMS list api Response
 */
interface MicroCMSListResponse<T> {
    contents: (T & MicroCMSListContent)[];
    totalCount: number;
    limit: number;
    offset: number;
}
/**
 * microCMS list content common types
 */
type MicroCMSListContent = MicroCMSContentId & MicroCMSDate;
/**
 * microCMS object content common types
 */
type MicroCMSObjectContent = MicroCMSDate;
interface MakeRequest {
    endpoint: string;
    contentId?: string;
    queries?: MicroCMSQueries & Record<string, any>;
    requestInit?: RequestInit;
}
type CustomRequestInit = Omit<RequestInit, 'method' | 'headers' | 'body'>;
interface GetRequest {
    endpoint: string;
    contentId?: string;
    queries?: MicroCMSQueries;
    customRequestInit?: CustomRequestInit;
}
interface GetListDetailRequest {
    endpoint: string;
    contentId: string;
    queries?: MicroCMSQueries;
    customRequestInit?: CustomRequestInit;
}
interface GetListRequest {
    endpoint: string;
    queries?: MicroCMSQueries;
    customRequestInit?: CustomRequestInit;
}
interface GetObjectRequest {
    endpoint: string;
    queries?: MicroCMSQueries;
    customRequestInit?: CustomRequestInit;
}
interface GetAllContentIdsRequest {
    endpoint: string;
    /**
     * @type {string} alternateField
     * @example 'url'
     * If you are using a URL other than the content ID, for example, you can specify that value in the `alternateField` field.
     */
    alternateField?: string;
    draftKey?: string;
    filters?: string;
    orders?: string;
    customRequestInit?: CustomRequestInit;
}
interface GetAllContentRequest {
    endpoint: string;
    queries?: Omit<MicroCMSQueries, 'limit' | 'offset' | 'ids'>;
    customRequestInit?: CustomRequestInit;
}
interface WriteApiRequestResult {
    id: string;
}
interface CreateRequest<T> {
    endpoint: string;
    contentId?: string;
    content: T;
    isDraft?: boolean;
    customRequestInit?: CustomRequestInit;
}
interface UpdateRequest<T> {
    endpoint: string;
    contentId?: string;
    content: Partial<T>;
    customRequestInit?: CustomRequestInit;
}
interface DeleteRequest {
    endpoint: string;
    contentId: string;
    customRequestInit?: CustomRequestInit;
}
type UploadMediaRequest = {
    data: File;
    name?: undefined;
    type?: undefined;
    customRequestHeaders?: undefined;
} | {
    data: Blob;
    name: string;
    type?: undefined;
    customRequestHeaders?: undefined;
} | {
    data: ReadableStream;
    name: string;
    type: `image/${string}`;
    customRequestHeaders?: undefined;
} | {
    data: URL | string;
    name?: string | null | undefined;
    type?: undefined;
    customRequestHeaders?: HeadersInit | null | undefined;
};

/**
 * Initialize SDK Client
 */
declare const createClient: ({ serviceDomain, apiKey, retry: retryOption, }: MicroCMSClient) => {
    get: <T = any>({ endpoint, contentId, queries, customRequestInit, }: GetRequest) => Promise<T>;
    getList: <T_1 = any>({ endpoint, queries, customRequestInit, }: GetListRequest) => Promise<MicroCMSListResponse<T_1>>;
    getListDetail: <T_2 = any>({ endpoint, contentId, queries, customRequestInit, }: GetListDetailRequest) => Promise<T_2 & MicroCMSContentId & MicroCMSDate>;
    getObject: <T_3 = any>({ endpoint, queries, customRequestInit, }: GetObjectRequest) => Promise<T_3 & MicroCMSDate>;
    getAllContentIds: ({ endpoint, alternateField, draftKey, filters, orders, customRequestInit, }: GetAllContentIdsRequest) => Promise<string[]>;
    getAllContents: <T_4 = any>({ endpoint, queries, customRequestInit, }: GetAllContentRequest) => Promise<(T_4 & MicroCMSContentId & MicroCMSDate)[]>;
    create: <T_5 extends Record<string | number, any>>({ endpoint, contentId, content, isDraft, customRequestInit, }: CreateRequest<T_5>) => Promise<WriteApiRequestResult>;
    update: <T_6 extends Record<string | number, any>>({ endpoint, contentId, content, customRequestInit, }: UpdateRequest<T_6>) => Promise<WriteApiRequestResult>;
    delete: ({ endpoint, contentId, customRequestInit, }: DeleteRequest) => Promise<void>;
};

declare const createManagementClient: ({ serviceDomain, apiKey, }: MicroCMSManagementClient) => {
    uploadMedia: ({ data, name, type, customRequestHeaders, }: UploadMediaRequest) => Promise<{
        url: string;
    }>;
};

export { type CreateRequest, type CustomRequestInit, type DeleteRequest, type Fetch, type GetAllContentIdsRequest, type GetAllContentRequest, type GetListDetailRequest, type GetListRequest, type GetObjectRequest, type GetRequest, type MakeRequest, type MicroCMSClient, type MicroCMSContentId, type MicroCMSDate, type MicroCMSImage, type MicroCMSListContent, type MicroCMSListResponse, type MicroCMSManagementClient, type MicroCMSObjectContent, type MicroCMSQueries, type UpdateRequest, type UploadMediaRequest, type WriteApiRequestResult, createClient, createManagementClient };
