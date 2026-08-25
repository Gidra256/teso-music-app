from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Demo music seeding is disabled for TesoHub Music."

    def handle(self, *args, **options):
        self.stdout.write(
            self.style.WARNING(
                "Demo music seeding is disabled. Add real songs and artists through the admin workflow."
            )
        )
