const fs = require("fs");

const core = require("@actions/core");

const AliyunClient = require('@alicloud/pop-core');

const input = {
  accessKeyId: core.getInput("access-key-id"),
  accessKeySecret: core.getInput("access-key-secret"),
  securityToken: core.getInput("security-token"),
  fullchainFile: core.getInput("fullchain-file"),
  keyFile: core.getInput("key-file"),
  certificateName: core.getInput("certificate-name"),
  cdnDomains: core.getInput("cdn-domains"),
  timeout: parseInt(core.getInput("timeout")) || 10000,
  retry: parseInt(core.getInput("retry")) || 3,
};

/**
 * @param {string} endpoint
 * @param {string} apiVersion
 * @param {string} action
 * @param {Record<string, unknown>} params
 */
function callAliyunApi(endpoint, apiVersion, action, params) {
  return new Promise((resolve, reject) => {
    let retryTimes = 0;
    const client = new AliyunClient({
      ...input.accessKeyId && input.accessKeySecret ? {
        accessKeyId: input.accessKeyId,
        accessKeySecret: input.accessKeySecret
      } : {},
      ...input.securityToken ? {
        securityToken: input.securityToken
      } : {},
      endpoint,
      apiVersion
    });

    const request = () => client
      .request(action, params, { method: "POST", timeout: input.timeout })
      .then(resolve)
      .catch(error => {
        console.log(`Aliyun Client Error ${++retryTimes}/${input.retry}`, error)
        if (retryTimes >= input.retry) reject(error);
        request();
      });
    request();
  });
}

async function deletePreviouslyDeployedCertificate() {
  const expired = await callAliyunApi(
    "https://cas.aliyuncs.com", "2020-04-07",
    "ListUserCertificateOrder",
    {
      OrderType: 'UPLOAD',
      Status: 'EXPIRED',
      Keyword: input.certificateName
    }
  );
  const willExpired = await callAliyunApi(
    "https://cas.aliyuncs.com", "2020-04-07",
    "ListUserCertificateOrder",
    {
      OrderType: 'UPLOAD',
      Status: 'EXPIRED',
      Keyword: input.certificateName
    }
  );
  for (const item of [...willExpired.CertificateOrderList, ...expired.CertificateOrderList]) {
    console.log(`Found previously deployed certificate ${item.CertificateId}. Deleting.`);

    await callAliyunApi(
      "https://cas.aliyuncs.com", "2020-04-07",
      "DeleteUserCertificate",
      {
        CertId: item.CertificateId
      }
    );
  }
}

async function deployCertificate() {
  const fullchain = fs.readFileSync(input.fullchainFile, "utf-8");
  const key = fs.readFileSync(input.keyFile, "utf-8");

  await deletePreviouslyDeployedCertificate();

  await callAliyunApi(
    "https://cas.aliyuncs.com", "2020-04-07",
    "UploadUserCertificate",
    {
      Cert: fullchain,
      Key: key,
      Name: input.certificateName
    }
  );
}

async function deployCertificateToCdn() {
  const domains = Array.from(new Set(input.cdnDomains.split(/\s+/).filter(x => x)));

  for (const domain of domains) {
    console.log(`Deploying certificate to CDN domain ${domain}.`);

    await callAliyunApi(
      "https://cdn.aliyuncs.com", "2018-05-10",
      "SetCdnDomainSSLCertificate",
      {
        DomainName: domain,
        CertName: input.certificateName,
        CertType: "cas",
        SSLProtocol: "on"
      }
    );
  }
}

async function main() {
  await deployCertificate();

  if (input.cdnDomains) await deployCertificateToCdn();
}

main().catch(error => {
  console.log(error.stack);
  core.setFailed(error);
  process.exit(1);
});
