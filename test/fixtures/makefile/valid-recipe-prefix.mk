.RECIPEPREFIX ?= !
question:
!@echo question assignment

.RECIPEPREFIX := >
custom:
>@echo custom

.RECIPEPREFIX :=
default:
	@echo default

.RECIPEPREFIX = $(PREFIX)
dynamic:
    @echo deliberately unverified
	@echo also unverified

.RECIPEPREFIX != printf '>'
shell-derived:
    @echo shell assignment is never executed or guessed
