// Command plaidfake runs the stand-in Plaid API for cross-service tests
// (scripts/integration.sh). It is never part of the service image.
package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/plaid/plaidtest"
)

func main() {
	f := plaidtest.New()
	defer f.Close()
	fmt.Println(f.URL)
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
}
