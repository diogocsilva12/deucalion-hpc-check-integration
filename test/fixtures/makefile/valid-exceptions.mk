# Continued assignments and rules are logical make lines, not recipes.
OBJECTS = one.o \
          two.o \
          three.o

define GENERATED_RECIPE
    echo spaces are data inside define
	echo tabs are data too
endef

ifeq ($(MODE),debug)
program: debug.o \
         common.o
else
program: release.o \
         common.o
endif
	$(CC) $(OBJECTS) -o $@

inline: prerequisite ; @echo inline recipe

configured: private CFLAGS += -g
	$(CC) $(CFLAGS) -c configured.c

target-prefix-is-not-global: .RECIPEPREFIX = >
	@echo target-specific assignment keeps the global tab prefix

with-gap:

# Blank lines and comments do not detach a recipe from its target.
	@echo after a gap

continued-recipe:
	@printf '%s\n' one \
      two \
      three
