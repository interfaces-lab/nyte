import type { Metadata } from "next";
import Link from "next/link";
import { DocArticle } from "../../_layout/article";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "How Nyte handles account information, local work, and remote connections.",
  alternates: { canonical: "https://nyte.sh/privacy" },
};

export default function Page() {
  return (
    <DocArticle
      eyebrow="Updated October 4, 2026"
      title="Privacy policy"
      lede="How Nyte handles your information when you use our website, apps, and account service."
      toc={[
        { title: "Who we are", url: "#operator", depth: 2 },
        { title: "Accounts and sign-in", url: "#accounts", depth: 2 },
        { title: "Your work and connections", url: "#work", depth: 2 },
        { title: "Service providers", url: "#providers", depth: 2 },
        { title: "Retention and deletion", url: "#retention", depth: 2 },
        { title: "Your choices", url: "#choices", depth: 2 },
        { title: "Children and changes", url: "#changes", depth: 2 },
      ]}
      next={{ title: "Terms of service", href: "/terms" }}
    >
      <h2 id="operator">Who we are</h2>
      <p>
        Nyte is operated by Min Chun Fu. This policy covers nyte.sh, the Nyte desktop and mobile
        apps, and the Nyte Connect account and relay service. For privacy questions or requests,
        email <a href="mailto:daniel.fu90@gmail.com">daniel.fu90@gmail.com</a>.
      </p>

      <h2 id="accounts">Accounts and sign-in</h2>
      <p>
        We use Clerk to manage accounts, sign-in, and sessions. Depending on how you sign in, Clerk
        processes your email address, name, profile image, account identifiers, and authentication
        and security information. We use this information to identify your account, display it in
        the app, connect your devices, and prevent unauthorized access.
      </p>
      <p>
        When you choose Google or GitHub sign-in, that provider shares the basic profile and email
        information you authorize with Clerk. Our sign-in connections request identity and email
        permissions. They do not request access to Gmail, Google Drive, or private GitHub
        repositories. Connecting a separate tool or integration is a different action with its own
        permissions.
      </p>
      <p>
        We use Google and GitHub account information for authentication, account display, and
        account security. We do not sell it, use it for advertising, or use it to train
        general-purpose AI models. Nyte's use of Google user data is subject to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>
        , including its applicable Limited Use requirements.
      </p>

      <h2 id="work">Your work and connections</h2>
      <p>
        The desktop host stores your conversations and workspace state on the machine running it.
        Files, prompts, tool results, and other context can leave that machine when you use a model
        provider, remote tool, integration, or remote connection. The services you choose receive
        the information needed for those requests and handle it under their own policies.
      </p>
      <p>
        Nyte Connect stores account and device identifiers, device names, desktop public keys, token
        hashes, session references, connection timestamps, and access or revocation status. These
        records let your phone find your desktop and let the desktop decide which devices may
        connect. Signing in to Nyte does not, by itself, upload your workspace or conversation
        history to Clerk.
      </p>
      <p>
        When you use Nyte Connect, requests and responses pass through a relay operated on
        Cloudflare. That traffic can include conversations, file contents, attachments, tool output,
        and device access tokens. Each connection uses transport encryption, but the relay
        terminates that encryption and can read the traffic. This connection is not end-to-end
        encrypted between your phone and desktop.
      </p>
      <p>
        Our website and service providers process technical information such as IP addresses,
        request times, browser or device information, and error or security events to deliver the
        service, diagnose failures, and limit abuse. Authentication uses cookies or locally stored
        session credentials. The desktop and mobile apps use operating-system credential storage for
        persistent sign-in and connection credentials.
      </p>

      <h2 id="providers">Service providers</h2>
      <p>
        We use <a href="https://clerk.com/legal/privacy-policy">Clerk</a> for authentication,{" "}
        <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare</a> for the Connect service
        and its database, and <a href="https://vercel.com/legal/privacy-policy">Vercel</a> for the
        website. Google and GitHub process their respective sign-in flows. Expo and app distribution
        services deliver mobile builds and updates. Providers may process information in countries
        other than yours.
      </p>
      <p>
        We share information as needed to operate the features you use, respond to your support
        requests, protect accounts and services, and comply with legal obligations. Model providers
        and integrations you configure receive the data you send through those features. We do not
        sell your personal information.
      </p>

      <h2 id="retention">Retention and deletion</h2>
      <p>
        Local conversations and files remain on your host until you remove them. Unlinking a device,
        signing out, or deleting an account does not erase files stored on your desktop, backups you
        keep, or information already sent to a model provider or integration.
      </p>
      <p>
        Account information is retained while your account is active. Connect keeps device and
        revocation records to enforce access decisions, including records for devices that have been
        removed. Signing out or unlinking a device does not automatically delete those records.
        Operational logs, backups, and records needed for security or legal obligations may remain
        after an account is closed.
      </p>
      <p>
        To request deletion of your Nyte account and associated service records, email{" "}
        <a href="mailto:daniel.fu90@gmail.com">daniel.fu90@gmail.com</a>. We may ask you to verify
        account ownership before acting. We will explain any records that need to be retained and
        why.
      </p>

      <h2 id="choices">Your choices</h2>
      <p>
        You can sign out, disconnect devices, and turn off remote access in the apps. You can also
        revoke Nyte's Google or GitHub connection in that provider's account settings. Revoking a
        provider connection does not itself delete your Nyte account or local work.
      </p>
      <p>
        Depending on where you live, you may have rights to access, correct, delete, or obtain a
        copy of your personal information, or to object to or restrict certain processing. Contact
        us to make a request. Where applicable, you may also complain to your local data-protection
        authority. We process account and connection information to provide the service you request,
        maintain its security, and meet applicable legal obligations.
      </p>

      <h2 id="changes">Children and changes</h2>
      <p>
        Nyte is a developer tool and is not directed to children under 13. Contact us if you believe
        a child has provided personal information through the service.
      </p>
      <p>
        We will update this page when our practices change and revise the date above. For material
        changes affecting account data, we will provide notice through the service or an account
        contact where required. Use of Nyte is also covered by our{" "}
        <Link href="/terms">terms of service</Link>.
      </p>
    </DocArticle>
  );
}
