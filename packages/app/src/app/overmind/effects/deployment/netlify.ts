import getTemplate from '@codesandbox/common/lib/templates';
import { NetlifySite, Sandbox } from '@codesandbox/common/lib/types';
import getNetlifyConfig from 'app/utils/getNetlifyConfig';
import axios from 'axios';

const NetlifyBaseURL = 'https://builder.csbops.io/netlify/site';

type Options = {
  getUserId(): string | null;
  provideJwtToken: () => any;
};

export default (() => {
  let _options: Options;
  let _jwtToken: string | undefined;
  const createHeaders = (jwt: string) =>
    jwt
      ? {
          Authorization: `Bearer ${jwt}`,
        }
      : {};

  return {
    initialize(options: Options) {
      _options = options;
    },
    async provideJwtCached() {
      if (!_jwtToken) {
        try {
          const token = await _options.provideJwtToken();
          setTimeout(() => {
            // Token expires after 10 seconds, for safety we actually cache the token
            // for 5 seconds
            _jwtToken = undefined;
          }, 5000);
          return token;
        } catch (e) {
          _jwtToken = undefined;
          return Promise.reject(e);
        }
      }

      return _jwtToken;
    },

    async getLogs(id: string) {
      const url = `${NetlifyBaseURL}/${id}/status`;
      const token = await this.provideJwtCached();

      const { data } = await axios.get(url, {
        headers: createHeaders(token),
      });

      return data;
    },
    async claimSite(sandboxId: string) {
      const userId = _options.getUserId();
      const token = await this.provideJwtCached();
      const sessionId = `${userId}-${sandboxId}`;

      const { data } = await axios.post(
        `${NetlifyBaseURL}/${sandboxId}/claim`,
        { sessionId },
        { headers: createHeaders(token) }
      );

      return data.claim;
    },
    async getDeployments(sandboxId: string): Promise<NetlifySite> {
      const token = await this.provideJwtCached();
      const response = await axios.get(`${NetlifyBaseURL}/${sandboxId}`, {
        headers: createHeaders(token),
      });

      return response.data;
    },
    async deploy(sandbox: Sandbox): Promise<string> {
      const token = await this.provideJwtCached();
      const userId = _options.getUserId();
      const template = getTemplate(sandbox.template);
      const buildCommand = (name: string) => {
        if (name === 'styleguidist') {
          return 'styleguide:build';
        }
        if (name === 'nuxt') {
          return 'generate';
        }

        return 'build';
      };
      const buildConfig = getNetlifyConfig(sandbox);
      // command needs to be passed without the package manager name
      const buildCommandFromConfig = (buildConfig.command || '')
        .replace('npm run', '')
        .replace('yarn ', '');
      let id = '';
      try {
        const { data } = await axios.request({
          url: `${NetlifyBaseURL}/${sandbox.id}`,
          headers: createHeaders(token),
        });

        id = data.site_id;
      } catch (e) {
        const { data } = await axios.post(
          NetlifyBaseURL,
          {
            name: `csb-${sandbox.id}`,
            sessionId: `${userId}-${sandbox.id}`,
          },
          { headers: createHeaders(token) }
        );
        id = data.site_id;
      }
      await axios.post(
        `${NetlifyBaseURL}/${sandbox.id}/deploy`,
        {
          siteId: id,
          dist: buildConfig.publish || template.distDir,
          buildCommand: buildCommandFromConfig || buildCommand(template.name),
        },
        { headers: createHeaders(token) }
      );

      return id;
    },
  };
})();
