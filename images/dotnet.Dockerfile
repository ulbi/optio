ARG BASE_IMAGE=optio-base:latest
FROM ${BASE_IMAGE}

USER root

# .NET 8.0 LTS SDK (official install script; arch-aware, no external apt repo needed)
RUN curl -fsSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0 --install-dir /usr/share/dotnet \
    && ln -sf /usr/share/dotnet/dotnet /usr/local/bin/dotnet

ENV DOTNET_ROOT=/usr/share/dotnet
ENV PATH="${DOTNET_ROOT}/bin:${DOTNET_ROOT}:/home/agent/.dotnet/tools:${PATH}"
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1
ENV DOTNET_NOLOGO=1
ENV NUGET_PACKAGES=/home/agent/.nuget/packages

USER agent

# NuGet package cache dir matches the "nuget-cache" shared-directory preset mountSubPath
RUN mkdir -p /home/agent/.nuget/packages && chmod 755 /home/agent/.nuget

# Common tools
RUN dotnet tool install -g dotnet-format