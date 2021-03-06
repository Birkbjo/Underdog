import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  ScannedAddonData,
  InstalledAddon,
  AddonSearchResult,
  GameFlavor,
  AddonFile,
  ReleaseType,
  AddonDirectory,
} from '../types';
import { extractZip, computeDirHash } from '../../../utils/utils';
import { selectPath } from '../../config/configSlice';

class AddonManager {
  installationPath: string;

  addonsPath: string;

  constructor(installationPath: string) {
    this.installationPath = installationPath;
    this.addonsPath = this.getAddonsPath();
  }

  getAddonsPath() {
    const addonsPath = path.join(this.installationPath, 'Interface', 'AddOns');
    if (fs.existsSync(addonsPath)) {
      return addonsPath;
    }
    throw new Error('AddOns directory not found!');
  }

  static async collectAddonInfo(addonPath: string): Promise<ScannedAddonData> {
    // regex to get toc-tags
    const tocTagRegex = /^## *(\w+): *(.*)/gm;

    const addonDirName = path.basename(addonPath);
    const addonInfo: Partial<ScannedAddonData> = {
      shortName: addonDirName,
    };

    const addonFileNames = await fs.promises.readdir(addonPath);
    const tocFileNames = addonFileNames.filter(
      (f) => path.extname(f).toLowerCase() === '.toc'
    );
    //console.log('toc', tocFileNames)
    // TOC should be same as dirname according to WoW addons spec
    const tocFileName = tocFileNames.find(
      (fName) => path.basename(fName, '.toc') === addonDirName
    );
    if (!tocFileName) {
      throw new Error(
        `Addon ${addonDirName} does not have a corresponding .toc file!`
      );
    }

    // read toc (table of contents) files
    const tocFile = await fs.promises.readFile(
      path.resolve(addonPath, tocFileName),
      'utf8'
    );

    // Collect TOC-tags
    Array.from(tocFile.matchAll(tocTagRegex), (m) => [m[1], m[2]]).reduce(
      (acc, curr: Array<string>) => {
        const infoName = curr[0].toLowerCase();
        const infoValue = curr[1];
        acc[infoName] = infoValue;
        return acc;
      },
      addonInfo
    );
      console.log("collected", addonInfo)
    return addonInfo as ScannedAddonData;
  }

  async scan(): Promise<ScannedAddonData[]> {
    const addonDirs = (
      await fs.promises.readdir(this.addonsPath, {
        withFileTypes: true,
      })
    ).filter((ad) => ad.isDirectory());
    console.log('Scanning!', addonDirs.length, ' addondirs');
    
    // loop addon dirs
    const addonsInfo = await Promise.all(
      addonDirs.map(async (ad) => {
        const addonInfo = await AddonManager.collectAddonInfo(
          path.resolve(this.addonsPath, ad.name)
        );
        return addonInfo;
      })
    );
    console.log('Scan complete', addonsInfo);
    return addonsInfo;
  }

  async installFile(
    addonInfo: AddonSearchResult,
    installFileInfo: AddonFile
  ): Promise<InstalledAddon> {
    const { downloadUrl } = installFileInfo;
    const zipFileRes = await fetch(downloadUrl);
    const arrayBuffer = await zipFileRes.arrayBuffer();
    const buff = Buffer.from(arrayBuffer);

    const zipChecksum = crypto.createHash('md5').update(buff).digest('hex');
    console.log(
      'Installing',
      installFileInfo.displayName,
      ' with hash',
      zipChecksum
    );

    const zip = await extractZip(buff, this.addonsPath);
    const entries = zip.getEntries();

    const rootDirs = entries.reduce((acc: Record<string, unknown>, curr) => {
      const { entryName } = curr;
      const rootDir = entryName.split(path.sep)[0];
      if (acc[rootDir]) {
        return acc;
      }
      const moduleMatch = installFileInfo.modules.find(
        (m) => m.foldername === rootDir
      );
      acc[rootDir] = {
        name: rootDir,
        isModule: moduleMatch && moduleMatch.type === 2,
      };
      return acc;
    }, {});

    const addonDirs = Object.values(rootDirs) as AddonDirectory[];
    const dirsPaths = addonDirs.map((ad) =>
      path.join(this.addonsPath, ad.name)
    );

    const dirHash = await computeDirHash(dirsPaths);

    return {
      id: addonInfo.id,
      name: addonInfo.name,
      addonInfo,
      installed: true,
      linked: true,
      installedDate: new Date().toISOString(),
      zipChecksum,
      dirChecksum: dirHash,
      version: installFileInfo.displayName,
      installedFile: installFileInfo,
      installedDirectiories: addonDirs,
    };
  }

  static getLatestFile(
    addon: AddonSearchResult,
    installOptions: InstallOptions = {
      gameFlavor: 'wow_retail',
      releaseType: ReleaseType.Release,
    }
  ): AddonFile | undefined {
    const sortedFiles = addon.latestFiles
      .filter(
        (f) =>
          f.gameVersionFlavor === installOptions.gameFlavor &&
          f.releaseType === installOptions.releaseType
      )
      .reverse();
    const latestFile = sortedFiles[0];

    if (!latestFile) {
      console.log(
        `Could not find a latest version for addon ${
          addon.name
        } with options ${JSON.stringify(installOptions, undefined, 4)}`
      );
    }

    return latestFile;
  }

  async installLatestFile(
    addon: AddonSearchResult,
    installOptions: InstallOptions = {
      gameFlavor: 'wow_retail',
      releaseType: ReleaseType.Release,
    }
  ): Promise<InstalledAddon> {
    const latestFile = await AddonManager.getLatestFile(addon, installOptions);

    return this.installFile(addon, latestFile);
  }

  async uninstallAddon(addon: InstalledAddon): Promise<boolean> {
    const folders = addon.installedDirectiories.map((dir) => {
      const dirPath = path.join(this.addonsPath, dir.name);
      return fs.promises.rmdir(dirPath, {
        recursive: true,
      });
    });

    try {
      await Promise.all(folders);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }
}

interface InstallOptions {
  gameFlavor?: GameFlavor;
  releaseType?: ReleaseType;
  overridePath?: string;
}

export default AddonManager;
