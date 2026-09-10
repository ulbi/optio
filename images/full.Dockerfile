ARG BASE_IMAGE=optio-base:latest
FROM ${BASE_IMAGE}

USER root

# Build essentials
RUN apt-get update && apt-get install -y \
    build-essential pkg-config libssl-dev \
    python3-full python3-pip python3-venv python3-dev \
    protobuf-compiler \
    postgresql-client redis-tools \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

# Node.js package managers (pnpm and yarn are already provided by corepack in the base image)
RUN curl -fsSL https://bun.sh/install | bash \
    && mv /root/.bun/bin/bun /usr/local/bin/ \
    && rm -rf /root/.bun

# Python tools
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && mv /root/.local/bin/uv /usr/local/bin/ \
    && mv /root/.local/bin/uvx /usr/local/bin/ \
    && rm -rf /root/.local \
    && pip3 install --break-system-packages poetry

# Go
ENV GOVERSION=1.23.4
RUN curl -fsSL "https://go.dev/dl/go${GOVERSION}.linux-$(dpkg --print-architecture).tar.gz" \
    | tar -C /usr/local -xzf -
ENV PATH="/usr/local/go/bin:/home/agent/go/bin:${PATH}"
ENV GOPATH="/home/agent/go"

RUN curl -fsSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0 --install-dir /usr/share/dotnet \
    && ln -sf /usr/share/dotnet/dotnet /usr/local/bin/dotnet \
    && mkdir -p /home/agent/.nuget/packages && chown -R agent:agent /home/agent/.nuget

ENV DOTNET_ROOT=/usr/share/dotnet
ENV PATH="/usr/share/dotnet/bin:/usr/share/dotnet:/home/agent/.dotnet/tools:${PATH}"
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1
ENV DOTNET_NOLOGO=1
ENV NUGET_PACKAGES=/home/agent/.nuget/packages

USER agent

# Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/home/agent/.cargo/bin:${PATH}"
