	@echo no target

spaced:
    @echo spaces

mixed:
  	@echo spaces before tab

.RECIPEPREFIX := >
>@echo no custom target

custom:
	@echo wrong prefix
