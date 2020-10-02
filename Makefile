.PHONY: clean
clean:
	rm -rf ./download

.PHONY: pretty
pretty:
	prettier --write --no-semi --single-quote **/*.{js,css}