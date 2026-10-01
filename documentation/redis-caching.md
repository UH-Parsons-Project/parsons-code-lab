# Redis-välimuisti

## Tarkoitus

Redisia käytetään tilastojen lyhytkestoiseen välimuistittamiseen. PostgreSQL on edelleen sovelluksen varsinainen tietolähde, eikä Redisissä säilytetä opiskelijoiden pysyvää dataa.

Tilastojen laskenta tekee useita tietokantakyselyitä ja käy Pythonissa läpi yrityksiä, sessioita, move- ja edit-tapahtumia sekä aikamittareita. Redis vähentää tätä työtä, kun sama tilasto pyydetään uudelleen.

Redis nopeuttaa cache hit -tilanteita. Ensimmäinen cache miss -pyyntö tekee edelleen normaalin laskennan.

## Käyttöönotto

Redis sisältyy Docker Composen `web`-profiiliin:

```bash
docker compose --profile web up --build
```

Palvelut:

- `redis`: paikallisen web-kehityksen Redis-palvelu
- `redis-test`: testiprofiilin Redis-palvelu

Web-sovellus käyttää osoitetta:

```text
redis://redis:6379/0
```

Testisovellus käyttää osoitetta:

```text
redis://redis-test:6379/0
```

Yhteysosoite tulee ympäristömuuttujasta `REDIS_URL`. Jos muuttuja puuttuu, Redis-välimuisti on pois käytöstä ja sovellus jatkaa laskemalla tulokset tietokannasta.

Python-riippuvuus on määritelty tiedostossa `requirements.txt`:

```text
redis[hiredis]>=5.0
```

## Toteutus

Yhteinen Redis-client on tiedostossa `backend/cache.py`. Se sisältää kolme päätoimintoa:

- `get_json(key)`: hakee ja JSON-dekoodaa arvon
- `set_json(key, value, ttl_seconds=3600)`: tallentaa arvon JSON-muodossa TTL:llä
- `invalidate_task_statistics(task_id, task_set_id, student_id)`: poistaa muuttuneeseen tehtävään liittyvät avaimet

Redis-kutsut ovat asynkronisia, jotta ne sopivat FastAPI- ja SQLAlchemy-async-arkkitehtuuriin.

Redis on toteutettu fail-open-periaatteella:

- cache-lukuvirhe palauttaa cache missin
- cache-kirjoitusvirhe ohitetaan
- invalidointivirhe ohitetaan
- tilasto voidaan aina laskea PostgreSQL:stä

Redis-client suljetaan sovelluksen graceful shutdownissa `backend/main.py`-tiedostossa.

## Välimuistitetut endpointit

### Tehtävän aggregaattitilasto

```text
GET /api/tasks/{task_id}/statistics
```

Tämä laskee yhden tehtävän opiskelijajoukon tilastot. Cache tarkistetaan käyttöoikeuksien tarkistamisen jälkeen.

### Opiskelijakohtainen tilasto

```text
GET /api/students/{student_id}/tasks/{task_id}/statistics?set_id={task_set_id}
```

Cacheen tallennetaan yhden opiskelijan, tehtävän ja task setin tulos.

Pydantic-response muutetaan ennen tallennusta JSON-yhteensopivaksi `model_dump(mode="json")`-kutsulla.

### Task setin kaikkien tehtävien tilastot

```text
GET /api/tasksets/{task_set_code}/tasks/statistics
```

Endpoint laskee task setin näkyvien tehtävien tilastot ja tallentaa koko koosteen yhtenä Redis-arvona. Ensimmäinen pyyntö tekee tehtäväkohtaiset laskennat, mutta seuraavat pyynnöt voivat palauttaa koko koosteen yhdellä cache-haulla.

## Cache-avaimet

Kaikissa avaimissa on `v1`-versio. Jos cacheen tallennettavan response-rakenne muuttuu epäyhteensopivasti, version voi vaihtaa `v2`:ksi.

| Käyttö | Avain |
| --- | --- |
| Julkinen tehtävätilasto | `stats:task:{task_id}:set:public:v1` |
| Task set -kohtainen tehtävätilasto | `stats:task:{task_id}:set:{task_set_id}:v1` |
| Opiskelijan tehtävätilasto | `stats:student:{student_id}:task:{task_id}:set:{task_set_id}:v1` |
| Koko task setin tilastokooste | `stats:taskset:aggregate:{task_set_id}:v1` |

Task set ja opiskelija ovat osa avainta, koska sama tehtävä voi näkyä eri opiskelijajoukoille ja eri rajauksilla.

## TTL

Oletus-TTL on yksi tunti eli 3600 sekuntia:

```python
await set_json(cache_key, value, ttl_seconds=3600)
```

TTL:n tarkoitus on:

- poistaa vanhat arvot automaattisesti
- estää cache-avainten rajaton kertymä
- toimia varmistuksena, jos jokin uusi kirjoituspolku unohtaa invalidoinnin

TTL ei yksin takaa välitöntä ajantasaisuutta. Siksi käytössä on myös explicit invalidointi.

## Invalidointi

Tilastocache mitätöidään opiskelijan kirjoituspolkujen onnistuneen tietokantacommitin jälkeen:

- tehtävän aloitus
- tehtävään siirtyminen
- uuden testituloksen eli submissionin tallennus
- tehtäväsession päättäminen

Tyypillinen järjestys on:

```python
await db.commit()
await invalidate_task_statistics(
    resolved_task_id,
    task_set.id,
    student_session.id,
)
```

Invalidointi poistaa tilanteesta riippuen seuraavat avaimet:

```text
stats:task:{task_id}:set:public:v1
stats:task:{task_id}:set:{task_set_id}:v1
stats:taskset:aggregate:{task_set_id}:v1
stats:student:{student_id}:task:{task_id}:set:{task_set_id}:v1
```

Commit tehdään ennen invalidointia, jotta Redis ei tyhjene tilanteessa, jossa tietokantamuutos epäonnistuu.

## Pyyntöjen kulku

### Cache miss

1. API tarkistaa käyttöoikeudet.
2. API muodostaa cache-avaimen.
3. Redisistä ei löydy arvoa.
4. API tekee tietokantakyselyt ja raskaan laskennan.
5. Tulos serialisoidaan JSONiksi.
6. Tulos tallennetaan Redisiin yhdeksi tunniksi.
7. Tulos palautetaan asiakkaalle.

### Cache hit

1. API tarkistaa käyttöoikeudet.
2. API muodostaa saman cache-avaimen.
3. Redis palauttaa JSON-arvon.
4. API palauttaa arvon ilman raskasta tilastolaskentaa.

Käyttöoikeuksia ei ohiteta cache hitillä, koska ne tarkistetaan ennen cache-hakua.

## Manuaalinen testaus

### Redis-palvelun tarkistus

```bash
docker compose --profile web up --build
docker compose exec redis redis-cli ping
```

Odotettu tulos:

```text
PONG
```

### Cache-avainten tarkistus

Tyhjennä Redis ennen testiä:

```bash
docker compose exec redis redis-cli FLUSHDB
```

Lataa opettajan tilastosivu selaimessa ja listaa avaimet:

```bash
docker compose exec redis redis-cli --scan --pattern 'stats:*'
```

Avaimia voi olla esimerkiksi:

```text
stats:task:1:set:1:v1
stats:task:2:set:1:v1
stats:taskset:aggregate:1:v1
```

### TTL:n tarkistus

Käytä täsmälleen yhtä riviä komentona:

```bash
docker compose exec redis redis-cli TTL 'stats:taskset:aggregate:1:v1'
```

Tulosten merkitykset:

- positiivinen luku: avain on olemassa ja vanhenee ilmoitettujen sekuntien kuluttua
- `-1`: avain on olemassa ilman TTL:ää
- `-2`: avainta ei ole olemassa, koska se on esimerkiksi vanhentunut tai invalidointi on poistanut sen

Pitkä Redis-avain voi katketa terminaalissa visuaalisesti seuraavalle riville. Se ei lisää avaimen nimeen rivinvaihtoa.

### Cache hitin tarkistus

Tyhjennä cache ja lataa sama tilastosivu kahdesti:

```bash
docker compose exec redis redis-cli FLUSHDB
docker compose exec redis redis-cli MONITOR
```

Ensimmäisellä pyynnöllä pitäisi näkyä `GET` ja myöhemmin `SET`. Toisella pyynnöllä pitäisi näkyä `GET`, jonka jälkeen API voi palauttaa tuloksen ilman uutta `SET`-kirjoitusta.

Lopeta monitorointi painamalla `Ctrl+C`.

### Invalidoinnin tarkistus

1. Tyhjennä Redis.
2. Lataa opettajan tilastosivu.
3. Varmista, että `stats:*`-avaimia syntyi.
4. Tee opiskelijana uusi yritys.
5. Tarkista avaimet uudelleen.
6. Lataa opettajan tilastosivu uudelleen.

Uuden yrityksen jälkeen tehtävään, task setiin ja kyseiseen opiskelijaan liittyvät avaimet poistetaan. Seuraava tilastopyyntö laskee uuden tuloksen ja luo cache-avaimet uudelleen.

### Redis-vikatilanteen tarkistus

Pysäytä Redis:

```bash
docker compose stop redis
```

Tilastosivun pitäisi edelleen toimia, mutta laskenta tehdään PostgreSQL:stä ja vastaus voi olla hitaampi. Käynnistä Redis uudelleen:

```bash
docker compose start redis
docker compose exec redis redis-cli ping
```

## Testit

Cache-helperien unit-testit ovat tiedostossa `tests/unit/test_cache.py`.

Rajattu testiajo Dockerissa:

```bash
docker compose --profile unittest run --rm unittest pytest -q \
  tests/unit/test_cache.py \
  tests/unit/test_student_api.py \
  tests/unit/test_statistic_api.py
```

Testit kattavat muun muassa:

- cache hitin
- cache missin
- JSON-serialisoinnin
- kaikkien tilastocache-avainten invalidoinnin
- Redis-virheiden fail-open-käytöksen
- student- ja statistic-endpointtien regressiot

## Rajoitukset ja jatkokehitys

Redis nopeuttaa erityisesti toistuvia pyyntöjä. Se ei nopeuta ensimmäistä cache miss -laskentaa.

Task setin ensimmäinen laskenta käsittelee tehtävät edelleen silmukassa. Seuraava mahdollinen optimointi olisi bulk-laskenta, jossa usean tehtävän yritykset, sessiot ja tapahtumat haetaan suuremmilla yhteiskyselyillä.

Redis-palvelun tuotantokäyttöön pitää lisäksi suunnitella muun muassa:

- verkon rajaus
- autentikointi tarvittaessa
- hostin `vm.overcommit_memory=1`-asetus
- Redis-palvelun seuranta ja kapasiteettirajat

## Tiedostot

| Tiedosto | Rooli |
| --- | --- |
| `backend/cache.py` | Redis-client, JSON-cache ja invalidointi |
| `backend/config.py` | `REDIS_URL`-asetus |
| `backend/main.py` | Redis-clientin sulkeminen shutdownissa |
| `backend/routes/statistic/statistic_api.py` | Tilastojen cache hit/miss -logiikka |
| `backend/routes/student/student_api.py` | Tilastocachejen invalidointi datamuutosten jälkeen |
| `docker-compose.yml` | Redis-palvelut web- ja testiprofiileissa |
| `requirements.txt` | Redis Python -riippuvuus |
| `tests/unit/test_cache.py` | Cache-helperien unit-testit |
