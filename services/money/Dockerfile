# Sagolik Close money service — static binary on distroless, non-root.
#   docker build -t sagolik-money services/money
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download && go mod verify
COPY . .
ENV CGO_ENABLED=0
RUN go build -trimpath -ldflags="-s -w -buildid=" -o /out/money ./cmd/money

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/money /money
USER nonroot:nonroot
EXPOSE 8443
# Health listens on MONEY_HEALTH_ADDR (default 127.0.0.1:8081); probe it from the orchestrator's sidecar/network policy.
ENTRYPOINT ["/money"]
