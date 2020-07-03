import { AddonSearchResult } from './types';
import fs from 'fs';

class CurseForgeAPI {
  baseURL: string;

  pageSize: number;

  cache: Record<string, number>;

  cacheTTL: number;

  constructor() {
    this.baseURL = 'https://addons-ecs.forgesvc.net/api/v2/addon';
    this.pageSize = 20;
    this.cache = {};
    this.cacheTTL = 30000;
  }

  request(url: RequestInfo, fetchOpts: RequestInit = {}) {
    type PartialCacheParams = 'force-cache' | 'reload';
    const currentTS = new Date().getTime();

    const timeSinceLastReq =
      currentTS - this.cache[url.toString()] || this.cacheTTL;
    const cacheStrategy =
      timeSinceLastReq < this.cacheTTL ? 'force-cache' : 'reload';

    if (cacheStrategy === 'reload') {
      this.cache[url.toString()] = currentTS;
      if (Object.keys(this.cache).length > 500) {
        this.cache = {};
      }
    }

    const mergedOpts = {
      ...fetchOpts,
      cache: cacheStrategy as PartialCacheParams,
    };

    return fetch(url, mergedOpts);
  }

  async search(addonName: string): Promise<AddonSearchResult[]> {
    const url = `${this.baseURL}/search?gameId=1&pageSize=${this.pageSize}&searchFilter=${addonName}`;

    const res = await this.request(url);
    const searchResult = await res.json();
    return searchResult as AddonSearchResult[];
  }

  async getChangeLog(addonId: number, fileId: string): Promise<string> {
    const res = await fetch(
      `${this.baseURL}/${addonId}/file/${fileId}/changelog`
    );
    const changeLogText = await res.text();
    return changeLogText;
  }

  async getPopularAddons(): Promise<AddonSearchResult[]> {
    const res = await fetch(`${this.baseURL}/featured`, {
      method: 'post',
    });

    const featuredAddons = await res.json();

    return featuredAddons.popular as AddonSearchResult[];
  }
}

export default new CurseForgeAPI();
