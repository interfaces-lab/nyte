import type { Metadata } from "next";
import Link from "next/link";
import { DocArticle } from "../../_layout/article";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "Terms for using the Nyte website, apps, and hosted account service.",
  alternates: { canonical: "https://nyte.sh/terms" },
};

export default function Page() {
  return (
    <DocArticle
      eyebrow="Updated October 4, 2026"
      title="Terms of service"
      lede="The terms for using Nyte's website, apps, and hosted services."
      toc={[
        { title: "Using Nyte", url: "#using-nyte", depth: 2 },
        { title: "Your account and work", url: "#your-work", depth: 2 },
        { title: "Agents and remote access", url: "#agents", depth: 2 },
        { title: "Acceptable use", url: "#acceptable-use", depth: 2 },
        { title: "Availability and responsibility", url: "#availability", depth: 2 },
        { title: "Ending use and changes", url: "#changes", depth: 2 },
      ]}
      previous={{ title: "Privacy policy", href: "/privacy" }}
    >
      <h2 id="using-nyte">Using Nyte</h2>
      <p>
        Nyte is operated by Min Chun Fu. These terms cover nyte.sh, the Nyte desktop and mobile
        apps, and the hosted Nyte Connect service. By using these services, you agree to these
        terms. You must have the legal capacity to agree to them and permission to act for any
        organization whose resources you use.
      </p>
      <p>
        Separate licenses may apply to software or third-party components distributed with Nyte.
        Those licenses govern the rights they grant. These terms govern our hosted services and do
        not replace those licenses.
      </p>

      <h2 id="your-work">Your account and work</h2>
      <p>
        You retain your rights in the files, prompts, and other content you provide. You give us
        permission to process and transmit that content only as needed to provide the features you
        use, maintain service security, and meet legal obligations. You are responsible for having
        the rights and permissions needed to use and share that content.
      </p>
      <p>
        Protect your account, provider credentials, devices, and connection tokens. Review the
        devices linked to your account and revoke access you no longer intend to allow. Notify us at{" "}
        <a href="mailto:daniel.fu90@gmail.com">daniel.fu90@gmail.com</a> if you believe someone has
        gained unauthorized access to your Nyte account.
      </p>
      <p>
        Our <Link href="/privacy">privacy policy</Link> describes how account information, local
        work, and remote connections are handled.
      </p>

      <h2 id="agents">Agents and remote access</h2>
      <p>
        Nyte can run tools, edit files, execute commands, and communicate with services under the
        permissions you provide. Review the access you grant and the actions an agent proposes. AI
        output can be inaccurate, incomplete, or unsafe. Check important results before relying on
        them, and keep backups of work you cannot afford to lose.
      </p>
      <p>
        Enabling remote access lets authorized devices interact with your desktop host. Keep that
        host secure and turn off remote access when it is no longer needed. Nyte Connect relays
        traffic through Cloudflare; it does not provide end-to-end encryption between your devices.
      </p>
      <p>
        Model providers, authentication providers, integrations, and app stores have their own terms
        and policies. You are responsible for charges from providers you configure. Signing in with
        Google or GitHub does not authorize Nyte to access your private repositories, email, or
        cloud files.
      </p>

      <h2 id="acceptable-use">Acceptable use</h2>
      <p>
        Use Nyte only for lawful activity and with authorization for the systems and data you
        access. Do not use the hosted service to steal credentials, distribute malware, invade
        others' privacy, bypass access controls, or disrupt the service. Do not attempt to access
        another user's account or connected devices without permission.
      </p>

      <h2 id="availability">Availability and responsibility</h2>
      <p>
        Nyte is under active development. Features may change, and hosted services may be
        interrupted or discontinued. We do not promise uninterrupted availability, preservation of
        every record, or that generated output will be correct. Maintain your own backups and a way
        to access your work without the hosted relay.
      </p>
      <p>
        To the extent permitted by applicable law, the services are provided as available and
        without warranties of merchantability, fitness for a particular purpose, or
        non-infringement. To the same extent, Min Chun Fu is not liable for indirect or
        consequential losses arising from use of the services, including lost profits or lost data.
        These terms do not exclude rights, warranties, or liability that the law does not allow us
        to exclude.
      </p>

      <h2 id="changes">Ending use and changes</h2>
      <p>
        You can stop using Nyte at any time, disable remote access, and request account deletion as
        described in the privacy policy. We may suspend hosted access to address abuse, security
        risks, legal requirements, or violations of these terms. This does not transfer ownership of
        your local files to us.
      </p>
      <p>
        We may update these terms as the service changes. We will revise the date on this page and
        provide notice of material changes where required. If you do not agree to the updated terms,
        stop using the affected hosted services.
      </p>
      <p>
        For questions about these terms, contact Min Chun Fu at{" "}
        <a href="mailto:daniel.fu90@gmail.com">daniel.fu90@gmail.com</a>.
      </p>
    </DocArticle>
  );
}
