export interface FilesystemItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FilesystemItem[];
  size?: number;
  modified?: string;
}

export interface FilesystemResponse {
  items: FilesystemItem[];
  path: string;
}
