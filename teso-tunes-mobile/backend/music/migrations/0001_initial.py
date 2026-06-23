# Generated for the Teso Tunes starter project.
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Artist",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=120)),
                (
                    "category",
                    models.CharField(
                        choices=[
                            ("Rappers", "Rappers"),
                            ("Other Secular Artists", "Other Secular Artists"),
                            ("Gospel Artists", "Gospel Artists"),
                        ],
                        max_length=40,
                    ),
                ),
                ("bio", models.TextField(blank=True)),
                ("photo", models.URLField(blank=True)),
                ("location", models.CharField(blank=True, max_length=120)),
                ("is_featured", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"ordering": ["name"]},
        ),
        migrations.CreateModel(
            name="Song",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=160)),
                ("audio_file", models.URLField(blank=True)),
                ("cover_image", models.URLField(blank=True)),
                ("genre", models.CharField(blank=True, max_length=80)),
                ("play_count", models.PositiveIntegerField(default=0)),
                ("release_date", models.DateField(blank=True, null=True)),
                ("is_featured", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "artist",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="songs",
                        to="music.artist",
                    ),
                ),
            ],
            options={"ordering": ["-is_featured", "-play_count", "title"]},
        ),
    ]
