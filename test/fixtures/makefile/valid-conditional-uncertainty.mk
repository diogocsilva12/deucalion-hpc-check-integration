ifeq ($(MODE),enabled)
enabled:
else
VALUE := disabled
endif
	@echo validity depends on the selected branch

ifeq ($(STYLE),one)
.RECIPEPREFIX := >
else
.RECIPEPREFIX := |
endif
prefix-varies:
    @echo prefix validity also depends on the selected branch

include path:with-colon.mk
