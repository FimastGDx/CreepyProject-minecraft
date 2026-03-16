export interface Version {
  name: string;
  url: string;
  id: string;
}

export interface Config {
  debug: boolean;
  current_version: string;
  current_version_code: number;
  versions: Version[];
  proxy?: string;
}

const config: Config = {
  debug: false,
  current_version: "v2.0.0",
  current_version_code: 1,
  versions: [
    { name: "1.7.20", id: "1.7.20", url: "s3://1.7.20.zip" },
    { name: "Alpha 1.2.3_03", id: "a1.2.3_03", url: "s3://a1.2.3_03.zip" },
    { name: "Alpha 1.2.3_03 Remastered", id: "a1.2.3_03-rem", url: "s3://a1.2.3_03-rem.zip" },
    { name: "Alpha 1.2.3_03 Reloaded", id: "a1.2.3_03-rel", url: "s3://a1.2.3_03-rel.zip" },
    { name: "Error 422", id: "error422", url: "s3://error422.zip" },
    { name: "HEX Remastered", id: "hex-rem", url: "s3://hex-rem.zip" },
    { name: "Minecraft Ghost", id: "ghost", url: "s3://ghost.zip" },
    { name: "Alpha 1.2.6_01", id: "a1.2.6_01", url: "s3://a1.2.6_01.zip" },
    { name: "Alpha 1.2.6_02", id: "a1.2.6_02", url: "s3://a1.2.6_02.zip" },
    { name: "Alpha 1.2.7", id: "a1.2.7", url: "s3://a1.2.7.zip" },
    { name: "Alpha 0.0.0", id: "a0.0.0", url: "s3://a0.0.0.zip" },
    { name: "Beta 1.7.1", id: "b1.7.1", url: "s3://b1.7.1.zip" }
  ],
  proxy: "http://user:pass@proxy-ip:port"
};


export default config;

/* fix DPI arguments:
-Dos.name="Windows 8" -Dsun.java2d.uiScale=1 -Dsun.java2d.dpiaware=true
*/
