# Deploying for free (October 2026)

Where to run Expense Tracker on the internet without paying, and how. Free tiers change often;
everything below was checked in October 2026 (sources at the end).

## What the app needs

| | |
|---|---|
| **One always-on process** | The API, the web app and the background jobs (bill reminders, nightly clean-up, exchange rates, email in, push notifications) all run in one Node process. A host that puts the app to sleep when nobody is using it stops the jobs too. |
| **PostgreSQL** | Everything is in the database, receipts and photos included, so there's no separate file storage to set up. pg-boss checks for work every few seconds, so the database is never idle. |
| **HTTPS on a fixed host name** | Passkeys, push notifications and installing the app on a phone all need HTTPS, and passkeys are tied to the host name. Choose the name once. |
| **Memory** | Measured with the production setup: app 230 MB, PostgreSQL 70 MB, Caddy 14 MB, about **315 MB** in total. A 1 GB machine is enough. |

## The options

| Option | Cost | Fit | Verdict |
|---|---|---|---|
| **Oracle Cloud Always Free, Ampere A1 VM** | Free for good. A card is needed to sign up. | ARM VM with up to 2 cores and 12 GB of RAM (halved in mid-2026, still far more than needed), 200 GB of disk, public IP. Regions in Mumbai and Hyderabad, the closest to Nepal. | **Recommended.** Runs the whole stack as it is, always on. |
| **Your own computer at home + Cloudflare Tunnel or Tailscale Funnel** | Free (Cloudflare needs a domain: a free `.com.np`, or about US$10 a year) | Any machine that stays on: an old laptop, a mini PC, a Raspberry Pi 4/5. No open ports. | **Good without a card.** Down when the machine or power is off. |
| **Google Cloud e2-micro** | Free for good. A card is needed. | 1 GB RAM, 30 GB disk, US regions only (about 250–300 ms from Nepal), 1 GB of outgoing data a month. | **Works**, slower from Nepal; needs swap to build. |
| Render (free) | Free | The app sleeps after 15 minutes; the free database is **deleted** 30 days after creation. | Not suitable. |
| Koyeb | No longer free for new accounts (since Feb 2026) | | Not suitable. |
| Fly.io | No free tier for new accounts (trial only) | About US$2–5 a month | Not free. |
| Railway | US$1 of credit a month | Enough for a small app or a database, not both | Not enough. |
| Neon (database only) | Free | 100 compute-hours a month, sleeps after 5 minutes. pg-boss keeps it awake, so the hours run out in under three weeks. | Not suitable for this app. |
| Supabase (database only) | Free | 500 MB of storage; receipts are stored in the database and fill it. | Too small. |
| AWS | US$100–200 of credits | Only for 6 months | Not free for long. |

## Option A: Oracle Cloud (recommended)

Roughly an hour, most of it waiting for sign-up and the first build.

### 1. Sign up

1. Go to <https://www.oracle.com/cloud/free/> and sign up.
2. **Home region:** choose **India West (Mumbai)** or **India South (Hyderabad)**, the closest
   to Nepal. It can't be changed later, and Always Free resources only exist in the home region.
3. **Card:** Oracle verifies a card with a small temporary hold and doesn't charge it. It needs a
   credit card, or a debit card that works like one (Visa/Mastercard, no PIN). Prepaid and
   virtual cards are refused. People in Nepal report that dollar cards from Nabil and Himalayan
   Bank work. The billing address must match the bank's records.

### 2. Keep the VM from being reclaimed

Oracle may stop Always Free VMs that look idle for a week (CPU, network and memory all under
20%). A personal finance app is idle most of the time, so:

1. In the console: **Billing & Cost Management → Upgrade and Manage Payment → Pay As You Go**.
   Always Free resources stay free; you only pay if you create something that isn't. People
   report that PAYG accounts aren't reclaimed for being idle (Oracle's page doesn't say so).
2. **Billing → Budgets → Create Budget**: US$1 for the whole account, with an email alert at
   100%. If anything ever starts costing money, you'll know the same day.

### 3. Create the VM

**Compute → Instances → Create instance:**

- **Image:** Canonical Ubuntu 24.04.
- **Shape:** Ampere, `VM.Standard.A1.Flex`, **2 OCPUs and 12 GB** (the whole free allowance;
  1 OCPU and 6 GB is plenty too).
- **Networking:** keep the default new network, with **Assign a public IPv4 address** on.
- **SSH keys:** upload your public key (`~/.ssh/id_ed25519.pub`; make one with
  `ssh-keygen -t ed25519` if you don't have it).
- **Boot volume:** the default 50 GB is fine (up to 200 GB is free).

If it says **Out of capacity**, try another availability domain, or try again later.
Note the **public IP address** once it's running.

### 4. Open ports 80 and 443

1. In the console: the instance's **Subnet → Security List → Add Ingress Rules**, source
   `0.0.0.0/0`:
   - TCP, destination port `80`
   - TCP, destination port `443`
   - UDP, destination port `443` (optional, for HTTP/3)
2. On the VM (`ssh ubuntu@YOUR_IP`), Oracle's Ubuntu image also has its own firewall rules:

   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```

### 5. Pick the host name

You need a name that points at the VM's IP and never changes:

- **Quickest, free:** a [DuckDNS](https://www.duckdns.org) subdomain. Sign in, create e.g.
  `mymoney`, and set its IP to the VM's. Your address is `mymoney.duckdns.org`.
- **Nicer, free for Nepali citizens:** a `.com.np` domain from <https://register.com.np>
  (citizenship certificate, approval in 1–2 days). Point it at a DNS host (e.g. Cloudflare's
  free DNS) and add an `A` record for, say, `money.yourname.com.np` → the VM's IP. With
  Cloudflare, keep the record **DNS only** (grey cloud) so Caddy can get its certificate.
- **Just to try it out:** `203-0-113-7.sslip.io` (the IP with dashes) works without signing up.
  It changes if the IP changes, so don't add passkeys or install the app while using it.

### 6. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit   # then ssh back in, so the group change applies
```

### 7. Get the code

The work so far is on the branch `claude/expense-tracker-design-p13llo` (there's no `main` yet).
If the repository is private, create a GitHub **fine-grained personal access token** with
read-only *Contents* access to this repository, and use it as the password when git asks.

```bash
git clone -b claude/expense-tracker-design-p13llo https://github.com/sumit6511/expense-tracker.git
cd expense-tracker
```

### 8. Settings

Create `.env` in the `expense-tracker` folder:

```bash
cat > .env <<EOF
SITE_ADDRESS=mymoney.duckdns.org
AUTH_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)
POSTGRES_PASSWORD=$(openssl rand -hex 24)
ALLOW_SIGNUP=true
EOF
chmod 600 .env
```

- `SITE_ADDRESS` is the host name from step 5, without `https://`.
- **Keep a copy of this file somewhere safe** (a password manager). The database password
  can't be changed by editing it later, and backups of webhook and bank-sync settings need the
  same `ENCRYPTION_KEY` to be read.
- Optional, for "Forgot password?" emails and invitations:
  `SMTP_URL=smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465` with a Gmail
  [app password](https://myaccount.google.com/apppasswords), and
  `MAIL_FROM=Expense Tracker <you@gmail.com>`.

### 9. Start it

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build
```

The first build takes a few minutes. Then:

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml ps
curl -I https://mymoney.duckdns.org/healthz    # HTTP/2 200
```

Caddy gets the HTTPS certificate on its own within a minute. If it doesn't, check
`docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml logs caddy`: usually
port 80 isn't reachable yet (step 4) or the host name doesn't point at the IP yet (step 5).

### 10. Make it yours

1. Open `https://mymoney.duckdns.org`, create your account and your household's.
2. Close sign-ups: set `ALLOW_SIGNUP=false` in `.env` and run the command from step 9 again.
   Invitations still work.
3. On your phone, open the site and choose **Add to Home Screen** (or Install app).
4. Turn on two-step sign-in or add a passkey under **Settings → Security**.

## Option B: your own computer at home

For a machine that's always on (an old laptop, a mini PC or a Raspberry Pi 4/5 with 64-bit
Linux), with Docker installed. Nothing is opened on your router.

### With Tailscale Funnel (no domain needed)

Your address will be `https://<machine>.<tailnet>.ts.net`.

1. Install Tailscale (<https://tailscale.com/download>) and run `sudo tailscale up`.
2. In the Tailscale admin console, under **DNS**, turn on **HTTPS Certificates**.
3. Publish port 3000: `sudo tailscale funnel --bg 3000`. It prints your public address
   (`https://<machine>.<tailnet>.ts.net`). If it says Funnel isn't enabled for your tailnet,
   open the link it prints to turn it on, then run it again.
4. Clone the code (step 7 above) and create `.env` as in step 8, but with
   `PUBLIC_URL=https://<machine>.<tailnet>.ts.net` instead of `SITE_ADDRESS`.
5. Start the app: `docker compose up -d --build`, then open the address.

### With Cloudflare Tunnel (your own domain)

Needs a domain whose DNS is on Cloudflare (a free `.com.np` works, see step 5 above).

1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel** (type
   *cloudflared*). Copy the token from the install command.
2. Add a **public hostname**: e.g. `money.yourname.com.np`, service `HTTP`, URL `app:3000`.
3. In `.env`, as in step 8, but with `PUBLIC_URL=https://money.yourname.com.np` and
   `TUNNEL_TOKEN=<the token>`.
4. Start it:

   ```bash
   docker compose -f docker-compose.yml -f deploy/docker-compose.tunnel.yml up -d --build
   ```

## Option C: Google Cloud e2-micro

Follow Option A from step 4 with these differences:

- Create the VM as **e2-micro** in `us-west1`, `us-central1` or `us-east1` (only these are
  free), with a 30 GB **standard** persistent disk and Ubuntu 24.04.
- Allow HTTP and HTTPS traffic in the VM's firewall settings (instead of step 4).
- 1 GB of RAM is enough to run the app but not to build it. Add swap first:

  ```bash
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```

## Running it

The commands below are for Option A. For Option B, drop the `-f` flags (Tailscale) or use
`deploy/docker-compose.tunnel.yml` (Cloudflare). To save typing on the server:

```bash
echo "alias dc='docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml'" >> ~/.bashrc
source ~/.bashrc
```

### Updating

```bash
cd ~/expense-tracker
git pull
dc up -d --build
```

Database changes are applied automatically when the app starts.

### Logs

```bash
dc logs -f app       # Ctrl+C to stop following
dc logs caddy
```

### Backups

A dump of the database is made every night and kept for 14 days, **on the same server**. Copy
them somewhere else regularly, or a lost VM means lost data:

```bash
# On the server: gather the dumps into a folder
cd ~/expense-tracker && rm -rf db-backups && dc cp backup:/backups ./db-backups

# On your own computer: download them
scp -r ubuntu@YOUR_IP:expense-tracker/db-backups ./expense-tracker-backups
```

Each workspace can also download a full backup in the app (**Settings → Data**).

### Restoring a dump, or moving to a new server

Set up the new server the same way, with the **same `.env`**, start it once, then:

```bash
dc stop app
dc exec -T db dropdb -U et expense_tracker
dc exec -T db createdb -U et expense_tracker
dc exec -T db pg_restore --no-owner -U et -d expense_tracker < expense-tracker-2026-10-05.dump
dc start app
```

(These steps were tested: a dump restored into a fresh stack, and its accounts signed in.)

## Sources

Checked in October 2026.

- Oracle Cloud Always Free: [Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [FAQ (cards)](https://www.oracle.com/cloud/free/faq/), [A1 limits halved in 2026 (InfoQ)](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/), [checking for the downgrade](https://dev.to/cash602cmd/how-to-check-if-your-oracle-cloud-a1-free-tier-instance-just-got-quietly-downgraded-2h6m), [keeping instances alive](https://blog.wiseowls.co.nz/index.php/2026/03/08/keeping-oracle-always-free-tier-instances-alive/), [sign-up from Nepal](https://khimananda.com/blog/oracle-cloud-free-tier-for-learning)
- Google Cloud: [free features](https://docs.cloud.google.com/free/docs/free-cloud-features)
- Render: [30-day free database](https://bex.co/blog/2026/09/23/render-free-postgres-30-day-expiry)
- Koyeb: [free plan closed to new users](https://github.com/robhunter/agentdeals/issues/2218)
- Fly.io: [pricing](https://docs.fly.io/about/pricing)
- Railway: [plans](https://docs.railway.com/pricing/plans)
- Neon: [plans](https://neon.com/docs/introduction/plans)
- Supabase: [free tier limits](https://dev.to/nayankyada/supabase-pricing-2026-free-tier-limits-compute-costs-when-to-upgrade-52af)
- AWS: [credits and 6-month free plan](https://aws.amazon.com/about-aws/whats-new/2025/07/aws-free-tier-credits-month-free-plan/)
- Cloudflare Tunnel: [now fully free](https://bex.co/blog/2026/07/28/cloudflare-tunnel-free-zero-open-ports-ingress)
- Tailscale Funnel: [free plans](https://tailscale.com/docs/account/manage-plans/free-plans-discounts), [Funnel limits](https://www.ssdnodes.com/learn/tailscale-funnel-limits-and-ports)
- Host names: [sslip.io](https://sslip.io), [DuckDNS](https://natchecker.com/blog/duckdns), [free .com.np domains](https://www.kailashcloud.com/blog/register-com-np-domain-name-in-nepal/)
- Caddy: [automatic HTTPS](https://caddyserver.com/docs/automatic-https)
